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

let globalAssets: POGOProtos.Networking.Responses.GetAssetDigestResponse = null;

async function getAssetDigest(client: pogobuf.Client): Promise<POGOProtos.Networking.Responses.GetAssetDigestResponse> {
    if (fs.existsSync('data/asset.digest.json')) {
        logger.info('Get asset digest from disk...');
        let content = await fs.readFile('data/asset.digest.json', 'utf8');
        globalAssets = JSON.parse(content);
        return globalAssets;
    } else {
        logger.info('Get asset digest from server...');
        globalAssets = await client.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', 5702);
        _.each(globalAssets.digest, digest => {
            // convert buffer to hex string so it's readable
            (<any>digest).key = digest.key.toString('hex');
        });

        logger.info('Save asset digest to file...');
        await fs.writeFile('data/asset.digest.json', JSON.stringify(globalAssets, null, 4), 'utf8');

        return globalAssets;
    }
}

async function downloadAssets(client: pogobuf.Client, assets: POGOProtos.Networking.Responses.GetAssetDigestResponse) {
    if (fs.existsSync('data/.skip')) return;

    let idx = 0;
    logger.info('Starting to download assets...');
    await Bluebird.map(assets.digest, async asset => {
        logger.info('Get asset from %s (%d, %d)', asset.bundle_name, ++idx, assets.digest.length);
        let response = await client.getDownloadURLs([ asset.asset_id ]);
        let data = await request.get(response.download_urls[0].url);
        await fs.writeFile(`data/${asset.bundle_name}`, data);
        logger.info('%s done. (%d, %d)', asset.bundle_name, ++idx, assets.digest.length);
        await Bluebird.delay(_.random(450, 550));
    });

    await fs.writeFile('data/.skip', 'skip', 'utf8');
}

async function getEncryptedFiles() {
    await fs.mkdir('data');

    logger.info('Login...');
    let login = new pogobuf.PTCLogin();
    if (process.env.proxy) login.setProxy(process.env.proxy);
    let token = await login.login(process.env.user, process.env.password);

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

    await client.init(false);

    logger.info('First request...');
    client.batchStart().getPlayer('FR', 'en', 'Europe/Paris');
    await client.batchCall();

    let assets = await getAssetDigest(client);
    logger.info('%d assets to download', assets.digest.length);

    await downloadAssets(client, assets);
}

function xor(a: Buffer, b: Buffer): Buffer {
    let length = Math.max(a.length, b.length);
    let buffer = new Buffer(length);
    for (let i = 0; i < length; ++i) {
        buffer[i] = a[i] ^ b[i]
    }
    return buffer;
}

async function decrypt() {
    let bundle = 'pokemon_icon_001';
    let data = await fs.readFile(`data/${bundle}`);
    let assetInfo = _.find(globalAssets.digest, asset => asset.bundle_name === bundle);
    let iv = data.slice(1, 17);
    let encrypted = data.slice(18, data.length - 20);
    let mask = new Buffer('50464169243B5D473752673E6B7A3477', 'hex');
    let key = xor(mask, new Buffer((<any>assetInfo).key, 'hex'));

    let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(encrypted); // Buffer.concat([decipher.update(encrypted) , decipher.final()]);
    await fs.writeFile(`data/${bundle}.png`, decrypted);
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
        // await getEncryptedFiles();
        await getAssetDigest(null);
        await decrypt();
    } catch (e) {
        logger.error(e);
    }
}

Main().then(() => logger.info('Done.'));