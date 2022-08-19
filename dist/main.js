"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const os = __importStar(require("os"));
const core = __importStar(require("@actions/core"));
const tc = __importStar(require("@actions/tool-cache"));
const utils_1 = require("@actions/github/lib/utils");
const plugin_throttling_1 = require("@octokit/plugin-throttling");
const ThrottlingOctokit = utils_1.GitHub.plugin(plugin_throttling_1.throttling);
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // set up auth/environment
            const token = process.env['GITHUB_TOKEN'];
            if (!token) {
                throw new Error(`GITHUB_TOKEN not specified`);
            }
            const octokit = new ThrottlingOctokit(Object.assign({ throttle: {
                    onRateLimit: (retryAfter, options) => {
                        core.warning(`RateLimit detected for request ${options.method} ${options.url}.`);
                        core.info(`Retrying after ${retryAfter} seconds.`);
                        return true;
                    },
                    onSecondaryRateLimit: (retryAfter, options) => {
                        core.warning(`SecondaryRateLimit detected for request ${options.method} ${options.url}.`);
                        core.info(`Retrying after ${retryAfter} seconds.`);
                        return true;
                    },
                } }, (0, utils_1.getOctokitOptions)(token)));
            let versionSpec = core.getInput("version");
            if (!versionSpec) {
                versionSpec = "latest";
            }
            const owner = "winchci";
            const repo = "winch";
            const osPlatform = os.platform();
            let osArch;
            switch (os.arch()) {
                case "x64":
                    osArch = "amd64";
                    break;
                default:
                    osArch = os.arch();
                    return;
            }
            let getReleaseUrl;
            if (versionSpec === "latest") {
                getReleaseUrl = yield octokit.rest.repos.getLatestRelease({
                    owner,
                    repo,
                });
                versionSpec = getReleaseUrl.data.name;
            }
            let toolPath = tc.find('winch', versionSpec, os.arch());
            if (toolPath) {
                core.info(`Found in cache @ ${toolPath}`);
            }
            else {
                if (!getReleaseUrl) {
                    getReleaseUrl = yield octokit.rest.repos.getReleaseByTag({
                        owner,
                        repo,
                        tag: versionSpec,
                    });
                }
                core.info(`resolved version ${versionSpec}`);
                let asset = getReleaseUrl.data.assets.find(obj => {
                    return obj.name.toLowerCase() == `${osPlatform}-${osArch}.tgz`;
                });
                if (!asset) {
                    const found = getReleaseUrl.data.assets.map(f => f.name);
                    throw new Error(`Could not find a release for ${versionSpec}. Found: ${found}`);
                }
                const extractFn = getExtractFn(asset.name);
                const url = asset.browser_download_url;
                core.info(`Downloading ${repo} ${versionSpec} from ${url}`);
                const downloadPath = yield tc.downloadTool(url);
                const extPath = yield extractFn(downloadPath);
                toolPath = yield tc.cacheDir(extPath, 'winch', versionSpec, os.arch());
                core.info(`Successfully extracted ${repo} ${versionSpec} to ${toolPath}`);
            }
            core.addPath(toolPath);
        }
        catch (error) {
            if (error instanceof Error) {
                core.setFailed(error.message);
            }
            else {
                core.setFailed("catastrophic failure, please file an issue");
            }
        }
    });
}
function getExtractFn(assetName) {
    if (assetName.endsWith('.tar.gz')) {
        return tc.extractTar;
    }
    else if (assetName.endsWith('.tgz')) {
        return tc.extractTar;
    }
    else if (assetName.endsWith('.zip')) {
        return tc.extractZip;
    }
    else {
        throw new Error(`Unreachable error? File is neither .tar.gz not .tgz nor .zip, got: ${assetName}`);
    }
}
run();
