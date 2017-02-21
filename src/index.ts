require('dotenv').config({silent: true});

import * as pogobuf from 'pogobuf';
import * as POGOProtos from 'node-pogo-protos';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as moment from 'moment';

async function Main() {
    try {
        let login = new pogobuf.PTCLogin();
        login.setProxy(process.env.PROXY);
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

        await client.batchStart().batchCall();

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