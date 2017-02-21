require('dotenv').config({silent: true});

import * as pogobuf from 'pogobuf';
import * as POGOProtos from 'node-pogo-protos';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as fs from 'fs-promise';
import * as request from 'request-promise';

const bfj = require('bfj');

async function getAssetDigest(client: pogobuf.Client): Promise<POGOProtos.Networking.Responses.GetAssetDigestResponse> {
    if (fs.existsSync('data/asset.digest.json')) {
        logger.info('Get asset digest from disk...');
        let content = await fs.readFile('data/asset.digest.json', 'utf8');
        return JSON.parse(content);
    } else {
        logger.info('Get asset digest from server...');
        let assets = await client.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', 5702);
        _.each(assets.digest, digest => {
            // convert buffer to hex string so it's readable
            (<any>digest).key = digest.key.toString('hex');
        });

        logger.info('Save asset digest to file...');
        await fs.writeFile('data/asset.digest.json', JSON.stringify(assets, null, 4), 'utf8');

        return assets;
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

async function Main() {
    try {
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

    } catch (e) {
        logger.error(e);
    }
}

logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': function() {
        return moment().format('HH:mm:ss');
    },
    'colorize': true,
    'level': 'debug',
});

Main().then(() => logger.info('Done.'));