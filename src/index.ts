require('dotenv').config({silent: true});

import * as pogobuf from 'pogobuf-vnext';
import * as POGOProtos from 'node-pogo-protos';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as fs from 'mz/fs';
import * as request from 'request-promise';

let crypto = require('crypto');
const winstonCommon = require('winston/lib/winston/common');

const RequestType = POGOProtos.Networking.Requests.RequestType;

let state = {
    actions: {
        getTranslations: false,
        download2DAssets: true,
        download3DAssets: false,
    },
    assets: {
        digest: [],
    },
    translationSettings: null,
};

async function init(): Promise<pogobuf.Client> {
    try {
        await fs.mkdir('data');
    } catch (e) {}

    logger.info('Connecting to pogo servers...');

    let client = new pogobuf.Client({
        authType: 'ptc',
        username: process.env.user,
        password: process.env.password,
        version: 6301,
        useHashingServer: true,
        hashingKey: process.env.hashkey,
        includeRequestTypeInResponse: true,
        proxy: process.env.proxy,
    });

    let initial = await client.init();
    _.each(initial, response => {
        if (response._requestType === RequestType.DOWNLOAD_SETTINGS) {
            let downloadSettings = response.settings;
            state.translationSettings = downloadSettings.translation_settings;
        }
    });

    return client;
}

async function getAssetDigest(client: pogobuf.Client) {
    if (fs.existsSync('data/asset.digest.json')) {
        logger.info('Get asset digest from disk...');
        let content = await fs.readFile('data/asset.digest.json', 'utf8');
        state.assets = JSON.parse(content);
    } else {
        logger.info('Get asset digest from server...');
        const version = (<any>client).options.version;
        state.assets = await client.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', version);
        _.each(state.assets.digest, digest => {
            // convert buffer to hex string so it's readable and more compact
            (<any>digest).key = digest.key.toString('hex');
        });

        logger.info('Save asset digest to file...');
        await fs.writeFile('data/asset.digest.json', JSON.stringify(state.assets, null, 2), 'utf8');
    }

    return state.assets;
}

async function download2DAssets(client: pogobuf.Client) {
    try {
        await fs.mkdir('data/2D');
    } catch (e) { /* nevermind */ }

    // get only 2D sprites
    let digest: any[] = _.filter(state.assets.digest, asset => _.startsWith(asset.bundle_name, 'pokemon_icon_'));

    logger.info('%d assets to download', digest.length);

    let idx = 0;
    logger.info('Starting to download assets...');
    await Bluebird.map(digest, async asset => {
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url, { encoding: null });
        data = decrypt(asset.bundle_name, data);
        await fs.writeFile(`data/${asset.bundle_name}`, data);
        logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, digest.length);
        await Bluebird.delay(_.random(450, 550));
    }, { concurrency: 1 });
}

async function download3DAssets(client: pogobuf.Client) {
    try {
        await fs.mkdir('data/3D');
    } catch (e) { /* nevermind */ }

    // get only 3D sprites
    let digest: any[] = _.filter(state.assets.digest, asset => _.startsWith(asset.bundle_name, 'pm0'));

    logger.info('%d assets to download', digest.length);

    let idx = 0;
    logger.info('Starting to download 3D assets...');
    await Bluebird.map(digest, async asset => {
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url, { encoding: null });
        data = decrypt(asset.bundle_name, data);
        await fs.writeFile(`data/3D/${asset.bundle_name}`, data);
        logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, digest.length);
        await Bluebird.delay(_.random(450, 550));
    }, { concurrency: 1 });
}

function xor(a: Buffer, b: Buffer): Buffer {
    let length = Math.max(a.length, b.length);
    let buffer = Buffer.alloc(length);
    for (let i = 0; i < length; ++i) {
        buffer[i] = a[i] ^ b[i];
    }
    return buffer;
}

function decrypt(bundle: string, data: Buffer): Buffer {
    if (data[0] !== 1) throw new Error('Incorrect data in file');

    let assetInfo = _.find(state.assets.digest, asset => asset.bundle_name === bundle);
    let iv = data.slice(1, 17);
    let mask = Buffer.from('50464169243b5d473752673e6b7a3477', 'hex');
    let key = xor(mask, Buffer.from((<any>assetInfo).key, 'hex'));

    let encrypted = data.slice(17, data.length - 20);
    if ((encrypted.length & 0x0F) !== 0) throw new Error('Invalid data length');

    let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = Buffer.concat([decipher.update(encrypted) , decipher.final()]);

    return decrypted;
}

async function getTranslations(client: pogobuf.Client) {
    let i18s: any[] = _.filter(state.assets.digest, digest => _.startsWith(digest.bundle_name, 'i18n_'));
    await Bluebird.each(i18s, async asset => {
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url, { encoding: null });
        data = decrypt(asset.bundle_name, data);
        await fs.writeFile(`data/${asset.bundle_name}.text`, data);
        logger.info('%s downloaded.', asset.bundle_name);
    });
}

logger.transports.Console.prototype.log = function (level, message, meta, callback) {
    const output = winstonCommon.log(Object.assign({}, this, {
        level,
        message,
        meta,
    }));
    console[level in console ? level : 'log'](output);
    setImmediate(callback, null, true);
};

logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': function() {
        return moment().format('HH:mm:ss');
    },
    'colorize': true,
    'level': 'debug',
});

async function Main() {
    try {
        let client = await init();
        await getAssetDigest(client);

        if (state.actions.getTranslations) {
            await getTranslations(client);
        }

        if (state.actions.download2DAssets) {
            await download2DAssets(client);
        }

        if (state.actions.download3DAssets) {
            await download3DAssets(client);
        }
    } catch (e) {
        logger.error(e);
    }
}

Main().then(() => logger.info('Done.'));