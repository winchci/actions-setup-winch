import * as os from "os";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { GitHub, getOctokitOptions} from "@actions/github/lib/utils";
import { throttling } from "@octokit/plugin-throttling";

const ThrottlingOctokit = GitHub.plugin(throttling);

async function run() {
    try {
        // set up auth/environment
        const token = process.env['GITHUB_TOKEN'];
        if (!token) {
            throw new Error(`GITHUB_TOKEN not specified`);
        }

        const octokit = new ThrottlingOctokit({
            throttle: {
                onRateLimit: (retryAfter, options) => {
                    core.warning(
                        `RateLimit detected for request ${options.method} ${options.url}.`
                    );
                    core.info(`Retrying after ${retryAfter} seconds.`);
                    return true;
                },
                onSecondaryRateLimit: (retryAfter, options) => {
                    core.warning(
                        `SecondaryRateLimit detected for request ${options.method} ${options.url}.`
                    );
                    core.info(`Retrying after ${retryAfter} seconds.`);
                    return true;
                },
            },
            ...getOctokitOptions(token),
        })

        let versionSpec = core.getInput("version");
        if (!versionSpec) {
            versionSpec = "latest";
        }

        const owner = "winchci";
        const repo = "winch";
        const osPlatform = os.platform();
        const osArch = os.arch();

        let osMatch: string[] = [];

        osMatch.push(osPlatform)
        switch (os.arch()) {
        case "x64":
            osMatch.push("amd64")
            break;

        default:
            osMatch.push(os.arch())
            return;
        }

        let getReleaseUrl;
        if (versionSpec === "latest") {
            getReleaseUrl = await octokit.rest.repos.getLatestRelease({
                owner,
                repo,
            });
            versionSpec = getReleaseUrl.data.name;
        }

        let toolPath = tc.find('winch', versionSpec, osArch);

        if (toolPath) {
            core.info(`Found in cache @ ${toolPath}`);
        } else {
            if (!getReleaseUrl) {
                getReleaseUrl = await octokit.rest.repos.getReleaseByTag({
                    owner,
                    repo,
                    tag: versionSpec,
                });
            }

            let osMatchRegexForm = `(${osMatch.join('|')})`
            let re = new RegExp(`${osMatchRegexForm}.*${osMatchRegexForm}.*\.(tar.gz|zip|tgz)`)
            core.info(`resolved version ${versionSpec}`);

            let asset = getReleaseUrl.data.assets.find(obj => {
                let normalizedObjName = obj.name.toLowerCase();
                core.info(`searching for ${normalizedObjName} with ${re.source}`);
                return re.test(normalizedObjName);
            })

            if (!asset) {
                const found = getReleaseUrl.data.assets.map(f => f.name);
                throw new Error(`Could not find a release for ${versionSpec}. Found: ${found}`)
            }

            const extractFn = getExtractFn(asset.name);

            const url = asset.browser_download_url;

            core.info(`Downloading ${repo} ${versionSpec} from ${url}`);
            const downloadPath = await tc.downloadTool(url);
            const extPath = await extractFn(downloadPath);

            toolPath = await tc.cacheDir(extPath, 'winch', versionSpec, osArch);
            core.info(`Successfully extracted ${repo} ${versionSpec} to ${toolPath}`);
        }

        core.addPath(toolPath);
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed("catastrophic failure, please file an issue")
        }
    }
}

function getExtractFn(assetName: any) {
    if (assetName.endsWith('.tar.gz')) {
        return tc.extractTar;
    } else if (assetName.endsWith('.tgz')) {
        return tc.extractTar;
    } else if (assetName.endsWith('.zip')) {
        return tc.extractZip;
    } else {
        throw new Error(`Unreachable error? File is neither .tar.gz not .tgz nor .zip, got: ${assetName}`);
    }
}

run();
