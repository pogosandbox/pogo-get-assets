"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const RequestType = POGOProtos.Networking.Requests.RequestType;
let state = {
    actions: {
        getTranslations: true,
        downloadAssets: false,
    },
    assets: null,
    translationSettings: null,
};
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.mkdir('data');
        }
        catch (e) { }
        logger.info('Connecting to pogo servers...');
        let client = new pogobuf.Client({
            authType: 'ptc',
            username: process.env.user,
            password: process.env.password,
            version: 6100,
            useHashingServer: true,
            hashingKey: process.env.hashkey,
            includeRequestTypeInResponse: true,
            proxy: process.env.proxy,
        });
        let initial = yield client.init();
        _.each(initial, response => {
            if (response._requestType === RequestType.DOWNLOAD_SETTINGS) {
                let downloadSettings = response.settings;
                state.translationSettings = downloadSettings.translation_settings;
            }
        });
        return client;
    });
}
function getAssetDigest(client) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync('data/asset.digest.json')) {
            logger.info('Get asset digest from disk...');
            let content = yield fs.readFile('data/asset.digest.json', 'utf8');
            state.assets = JSON.parse(content);
        }
        else {
            logger.info('Get asset digest from server...');
            state.assets = yield client.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', 5702);
            _.each(state.assets.digest, digest => {
                // convert buffer to hex string so it's readable and more compact
                digest.key = digest.key.toString('hex');
            });
            logger.info('Save asset digest to file...');
            yield fs.writeFile('data/asset.digest.json', JSON.stringify(state.assets, null, 2), 'utf8');
        }
        return state.assets;
    });
}
function downloadAssets(client) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync('data/.skip'))
            return;
        // get only 2D sprites
        state.assets.digest = _.filter(state.assets.digest, asset => _.startsWith(asset.bundle_name, 'pokemon_icon_'));
        logger.info('%d assets to download', state.assets.digest.length);
        let idx = 0;
        logger.info('Starting to download assets...');
        yield Bluebird.map(state.assets.digest, (asset) => __awaiter(this, void 0, void 0, function* () {
            let response = yield client.getDownloadURLs([asset.asset_id]);
            let data = yield request.get(response.download_urls[0].url);
            yield fs.writeFile(`data/${asset.bundle_name}`, data);
            logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, state.assets.digest.length);
            yield Bluebird.delay(_.random(450, 550));
        }), { concurrency: 1 });
        // so we don't download again at next launch
        yield fs.writeFile('data/.skip', 'skip', 'utf8');
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
function decrypt(bundle, data) {
    return __awaiter(this, void 0, void 0, function* () {
        // if (data[0] !== 1) throw new Error('Incorrect data in file');
        let assetInfo = _.find(state.assets.digest, asset => asset.bundle_name === bundle);
        let iv = data.slice(1, 17);
        let mask = Buffer.from('50464169243b5d473752673e6b7a3477', 'hex');
        let key = xor(mask, Buffer.from(assetInfo.key, 'hex'));
        let encrypted = data.slice(18, data.length - 20);
        if ((encrypted.length & 0x0F) !== 0)
            throw new Error('Invalid data length');
        let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted;
    });
}
function getTranslations(client) {
    return __awaiter(this, void 0, void 0, function* () {
        yield Bluebird.each(state.translationSettings.translation_bundle_ids, (bundle) => __awaiter(this, void 0, void 0, function* () {
            let asset = _.find(state.assets.digest, asset => asset.bundle_name === bundle);
            let response = yield client.getDownloadURLs([asset.asset_id]);
            let data = yield request.get(response.download_urls[0].url);
            data = decrypt(bundle, data);
            yield fs.writeFile(`data/${asset.bundle_name}`, data);
            logger.info('%s downloaded.', asset.bundle_name);
        }));
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
            let client = yield init();
            yield getAssetDigest(client);
            if (state.actions.getTranslations) {
                yield getTranslations(client);
            }
            if (state.actions.downloadAssets) {
                yield downloadAssets(client);
                // await getAssetDigest(null);
                yield decrypt();
            }
        }
        catch (e) {
            logger.error(e);
        }
    });
}
Main().then(() => logger.info('Done.'));
//# sourceMappingURL=index.js.map