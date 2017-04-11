require('dotenv').config({silent: true});

import * as pogobuf from 'pogobuf';
import * as POGOProtos from 'node-pogo-protos';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as fs from 'fs-promise';
import * as request from 'request-promise';

let crypto = require('crypto');

const RequestType = POGOProtos.Networking.Requests.RequestType;

let state = {
    actions: {
        getTranslations: true,
        downloadAssets: false,
    },
    assets: <POGOProtos.Networking.Responses.GetAssetDigestResponse> null,
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
        version: 6100,
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

async function getAssetDigest(client: pogobuf.Client): Promise<POGOProtos.Networking.Responses.GetAssetDigestResponse> {
    if (fs.existsSync('data/asset.digest.json')) {
        logger.info('Get asset digest from disk...');
        let content = await fs.readFile('data/asset.digest.json', 'utf8');
        state.assets = JSON.parse(content);
    } else {
        logger.info('Get asset digest from server...');
        state.assets = await client.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', 5702);
        _.each(state.assets.digest, digest => {
            // convert buffer to hex string so it's readable and more compact
            (<any>digest).key = digest.key.toString('hex');
        });

        logger.info('Save asset digest to file...');
        await fs.writeFile('data/asset.digest.json', JSON.stringify(state.assets, null, 2), 'utf8');
    }

    return state.assets;
}

async function downloadAssets(client: pogobuf.Client) {
    if (fs.existsSync('data/.skip')) return;

    // get only 2D sprites
    state.assets.digest = _.filter(state.assets.digest, asset => _.startsWith(asset.bundle_name, 'pokemon_icon_'));

    logger.info('%d assets to download', state.assets.digest.length);

    let idx = 0;
    logger.info('Starting to download assets...');
    await Bluebird.map(state.assets.digest, async asset => {
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url);
        await fs.writeFile(`data/${asset.bundle_name}`, data);
        logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, state.assets.digest.length);
        await Bluebird.delay(_.random(450, 550));
    }, { concurrency: 1 });

    // so we don't download again at next launch
    await fs.writeFile('data/.skip', 'skip', 'utf8');
}

function xor(a: Buffer, b: Buffer): Buffer {
    let length = Math.max(a.length, b.length);
    let buffer = Buffer.alloc(length);
    for (let i = 0; i < length; ++i) {
        buffer[i] = a[i] ^ b[i]
    }
    return buffer;
}

async function decrypt(bundle, data) {
    // if (data[0] !== 1) throw new Error('Incorrect data in file');

    let assetInfo = _.find(state.assets.digest, asset => asset.bundle_name === bundle);
    let iv = data.slice(1, 17);
    let mask = Buffer.from('50464169243b5d473752673e6b7a3477', 'hex');
    let key = xor(mask, Buffer.from((<any>assetInfo).key, 'hex'));

    let encrypted = data.slice(18, data.length - 20);
    if ((encrypted.length & 0x0F) !== 0) throw new Error('Invalid data length');

    let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = Buffer.concat([decipher.update(encrypted) , decipher.final()]);

    return decrypted;
}

async function getTranslations(client: pogobuf.Client) {
    await Bluebird.each(state.translationSettings.translation_bundle_ids, async bundle => {
        let asset = _.find(state.assets.digest, asset => asset.bundle_name === bundle);
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url);
        data = decrypt(bundle, data);
        await fs.writeFile(`data/${asset.bundle_name}`, data);
        logger.info('%s downloaded.', asset.bundle_name);
    });
}

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

        if (state.actions.downloadAssets) {
            await downloadAssets(client);
            // await getAssetDigest(null);
            await decrypt();
        }
    } catch (e) {
        logger.error(e);
    }
}

Main().then(() => logger.info('Done.'));