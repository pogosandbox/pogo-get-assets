"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
require('dotenv').config({ silent: true });
const pogobuf = require("pogobuf");
const POGOProtos = require("node-pogo-protos");
const logger = require("winston");
const Bluebird = require("bluebird");
const _ = require("lodash");
const moment = require("moment");
const fs = require("fs-promise");
const request = require("request-promise");
const bfj = require('bfj');
function getAssetDigest(client) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync('data/asset.digest.json')) {
            logger.info('Get asset digest from disk...');
            let content = yield fs.readFile('data/asset.digest.json', 'utf8');
            return JSON.parse(content);
        }
        else {
            logger.info('Get asset digest from server...');
            let assets = yield client.getAssetDigest(1 /* IOS */, '', '', '', 5702);
            _.each(assets.digest, digest => {
                // convert buffer to hex string so it's readable
                digest.key = digest.key.toString('hex');
            });
            logger.info('Save asset digest to file...');
            yield fs.writeFile('data/asset.digest.json', JSON.stringify(assets, null, 4), 'utf8');
            return assets;
        }
    });
}
function downloadAssets(client, assets) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync('data/.skip'))
            return;
        let idx = 0;
        logger.info('Starting to download assets...');
        yield Bluebird.map(assets.digest, (asset) => __awaiter(this, void 0, void 0, function* () {
            logger.info('Get asset from %s (%d, %d)', asset.bundle_name, ++idx, assets.digest.length);
            let response = yield client.getDownloadURLs([asset.asset_id]);
            let data = yield request.get(response.download_urls[0].url);
            yield fs.writeFile(`data/${asset.bundle_name}`, data);
            logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, assets.digest.length);
            yield Bluebird.delay(_.random(450, 550));
        }));
        yield fs.writeFile('data/.skip', 'skip', 'utf8');
    });
}
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.mkdir('data');
            logger.info('Login...');
            let login = new pogobuf.PTCLogin();
            if (process.env.proxy)
                login.setProxy(process.env.proxy);
            let token = yield login.login(process.env.user, process.env.password);
            let client = new pogobuf.Client({
                authType: 'ptc',
                authToken: token,
                version: 4500,
                useHashingServer: false,
                hashingKey: null,
                mapObjectsThrottling: false,
                includeRequestTypeInResponse: true,
                proxy: process.env.proxy,
            });
            yield client.init(false);
            logger.info('First request...');
            client.batchStart().getPlayer('FR', 'en', 'Europe/Paris');
            yield client.batchCall();
            let assets = yield getAssetDigest(client);
            logger.info('%d assets to download', assets.digest.length);
            yield downloadAssets(client, assets);
        }
        catch (e) {
            logger.error(e);
        }
    });
}
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': function () {
        return moment().format('HH:mm:ss');
    },
    'colorize': true,
    'level': 'debug',
});
Main().then(() => logger.info('Done.'));
//# sourceMappingURL=index.js.map