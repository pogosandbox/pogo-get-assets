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
const logger = require("winston");
const moment = require("moment");
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let login = new pogobuf.PTCLogin();
            login.setProxy(process.env.PROXY);
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
            yield client.batchStart().batchCall();
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