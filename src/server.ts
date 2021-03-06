import { randomBytes } from 'crypto';

import log from 'npmlog';

import { KoshareReconnectClient } from '@yume-chan/koshare-router';
import Socks5ServerConnection from '@yume-chan/socks5-server';

import { prefix } from './common';
import { KoshareRtcSignalTransport } from './koshare-rtc-signal-transport';
import RtcDataConnection from './rtc-data-connection';
import { RtcSignalServer } from './rtc-signal';
import { Transform } from 'stream';

log.level = 'silly';

const serverId = process.argv[2] || randomBytes(8).toString('base64');

class LogStream extends Transform {
    private _name: string;

    private _received: number = 0;

    public constructor(name: string) {
        super();

        this._name = name;
    }

    public _transform(chunk: Buffer, encoding: string, callback: () => void): void {
        this._received += chunk.length;
        log.verbose('stream', `stream ${this._name} reviced ${chunk.length}/${this._received} bytes`);
        this.push(chunk, encoding);
        callback();
    }
}

(async () => {
    await RtcDataConnection.listen(new RtcSignalServer(
        serverId,
        new KoshareRtcSignalTransport(
            await KoshareReconnectClient.connect('wss://chensi.moe/koshare', prefix))),
        (connection) => {
            connection.on('error', (error) => {
                log.warn('forward', 'connection error: %s', error.message);
                log.warn('forward', error.stack!);
            });

            connection.on('data-channel-stream', (client) => {
                const remote = new Socks5ServerConnection();

                client.pipe(remote);
                remote.pipe(client);

                client.on('error', (error) => {
                    log.warn('forward', 'client %s error: %s', client.label, error.message);
                    log.warn('forward', error.stack!);

                    remote.end();
                });
                remote.on('error', (error) => {
                    log.warn('forward', 'server %s error: %s', client.label, error.message);
                    log.warn('forward', error.stack!);

                    client.end();
                });

                client.on('close', () => {
                    log.info('forward', `data channel ${client.label} closed by client`);

                    remote.end();
                });
                remote.on('close', () => {
                    log.info('forward', `data channel ${client.label} closed by remote`);

                    client.end();
                });
            });
        },
        { iceServers: [{ urls: 'stun:stun.sipgate.net' }] }
    );

    log.info('server', 'server id: %s', serverId);
})();
