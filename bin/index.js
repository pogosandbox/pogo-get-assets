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
let crypto = require('crypto');
let globalAssets = null;
function getAssetDigest(client) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync('data/asset.digest.json')) {
            logger.info('Get asset digest from disk...');
            let content = yield fs.readFile('data/asset.digest.json', 'utf8');
            globalAssets = JSON.parse(content);
            return globalAssets;
        }
        else {
            logger.info('Get asset digest from server...');
            globalAssets = yield client.getAssetDigest(1 /* IOS */, '', '', '', 5702);
            _.each(globalAssets.digest, digest => {
                // convert buffer to hex string so it's readable
                digest.key = digest.key.toString('hex');
            });
            // get only 2d sprites
            globalAssets.digest = _.filter(globalAssets.digest, asset => _.startsWith(asset.bundle_name, 'pokemon_icon_'));
            logger.info('Save asset digest to file...');
            yield fs.writeFile('data/asset.digest.json', JSON.stringify(globalAssets, null, 4), 'utf8');
            return globalAssets;
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
            let response = yield client.getDownloadURLs([asset.asset_id]);
            let data = yield request.get(response.download_urls[0].url);
            yield fs.writeFile(`data/${asset.bundle_name}`, data);
            logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, assets.digest.length);
            yield Bluebird.delay(_.random(450, 550));
        }), { concurrency: 1 });
        yield fs.writeFile('data/.skip', 'skip', 'utf8');
    });
}
function getEncryptedFiles() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.mkdir('data');
        }
        catch (e) { }
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
    });
}
function xor(a, b) {
    let length = Math.max(a.length, b.length);
    let buffer = Buffer.alloc(length);
    for (let i = 0; i < length; ++i) {
        buffer[i] = a[i] ^ b[i];
    }
    return buffer;
}
function decrypt() {
    return __awaiter(this, void 0, void 0, function* () {
        let bundle = 'pokemon_icon_001';
        let data = yield fs.readFile(`data/${bundle}`);
        if (data[0] !== 1)
            throw new Error('Incorrect data in file');
        let assetInfo = _.find(globalAssets.digest, asset => asset.bundle_name === bundle);
        let iv = data.slice(1, 17);
        let mask = Buffer.from('50464169243b5d473752673e6b7a3477', 'hex');
        let key = xor(mask, Buffer.from(assetInfo.key, 'hex'));
        let encrypted = data.slice(18, data.length - 20);
        if ((encrypted.length & 0x0F) !== 0)
            throw new Error('Invalid data length');
        let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        yield fs.writeFile(`data/${bundle}.png`, decrypted);
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
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield getEncryptedFiles();
            // await getAssetDigest(null);
            yield decrypt();
        }
        catch (e) {
            logger.error(e);
        }
    });
}
Main().then(() => logger.info('Done.'));
//# sourceMappingURL=index.js.map