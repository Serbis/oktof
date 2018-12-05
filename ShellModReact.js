import React, { Component } from 'react';
import Serializer from "../shell/Serializer";
import * as protobuf from "protobufjs/index";
import {decodeUTF8, encodeUTF8, appendBuffer} from "../utils/BinaryUtils";
import {StreamControls} from "../utils/StreamControls";
import {ProtoManifest} from "../shell/ProtoManifest";

/** This class implements react support for okto shell operations. In the minimal use case, the class
 * inheritor should initialize the value of this.shell.address and then start the shell session via
 * this.startMod(). The logic of the component’s work is that after the connection is established,
 * two types of actions can be performed - push something to the shell or wait for something from
 * it. Getting data from a shell comes down to calling the so-called expector, a function that
 * determines what is expected from the shell. This function returns a promise, which can complete
 * either successfully, if the expected data were received, or not, if something else was received.
 */
class ShellModReact extends Component {
    constructor(props) {
        super(props);

        this.shell = {
            //current expector
            expector: undefined,
            //internal data buffer of overseas expector function
            buff: new Uint8Array(0),
            //ws connection rejection timeout
            connectionTimeout: 5000,
            //ws connection status
            connectionStatus: 0,
            //ws connection retry counter
            connectRetryCounter: 0
        };

        this.logs = {
            //pool of the LogEntry objects
            pool: [],
            //max entries in the pool
            max: 200,
            //log to the console
            console: true,
            //marker
            source: "default",
            start: 0,
            //log write callback
            onPush: undefined
        };

        this.mod = {
          mustStart: false
        };

        this.log = this.__log();

        let self= this;

        //Load protobuf models
        protobuf.load("messages.proto", function(err, root) {
            if (err) {
                //eventBus.publish(LogEvents.publisher, LogEvents.Actions._pushErrorLog, "Protocol buffer инициализирован с ошибкой. Смотри дебаг вывод");
                console.error(err);
            } else {
                self.shell.serializer = new Serializer({
                    Data: root.lookupType("proto.Data")
                });
                if (self.mod.mustStart)
                    self.startMod();
            }
        });
    }

    //TODO нужно как-то реализовать режим keepalive (слать что-то в соединение)
    /** Start shell session */
    startMod() {
        if (this.shell.serializer === undefined)
            this.mod.mustStart = true;
        else
            this.__createNewConnection(this, this.shell.address)
    }

    /** Expect raw binary data from the shell */
    expectRaw(chain) {
        let self = this;
        return new Promise((r, o) => {
            self.shell.expector = self.__rawExpector;
            self.shell.promise = [r, o];
            if (self !== undefined)
                self.shell.chain = chain;
            self.__rawExpector(self);
        });
    }

    /** Expect PROMPT control char from the shell */
    expectPrompt(chain) {
        let self = this;
        return new Promise((r, o) => {
            self.shell.expector = self.__promptExpector;
            self.shell.promise = [r, o];
            if (self !== undefined)
                self.shell.chain = chain;
            self.__promptExpector(self);
        });
    }

    /** Expect EOP control char from the shell */
    expectEop(chain) {
        let self = this;
        return new Promise((r, o) => {
            self.shell.expector = self.__eopExpector;
            self.shell.promise = [r, o];
            if (chain !== undefined)
                self.shell.chain = chain;
            self.__eopExpector(self);
        });
    }

    /** Write string data to the shell */
    write(str) {
        let data = new Uint8Array(appendBuffer(encodeUTF8(str), new Uint8Array([StreamControls.EOI])));
        let serializedMessage = this.shell.serializer.toBinary(ProtoManifest.m_Data, { data: data });
        this.shell.connection.send(serializedMessage)
    }

    /** Expect data from the shell and return it as string */
    read(chain) {
        let self = this;
        return new Promise((r, o) => {
            self.shell.expector = self.__readExpector;
            self.shell.promise = [r, o];
            if (chain !== undefined)
                self.shell.chain = chain;
            self.__readExpector(self);
        });
    }

    //private function
    __log() {
        return {
            debug: (msg) => {
                this.__writeLog(msg, 0)
            },
            info: (msg) => {
                this.__writeLog(msg, 1)
            },
            warning: (msg) => {
                this.__writeLog(msg, 2)
            },
            error: (msg) => {
                this.__writeLog(msg, 3)
            },
        }
    };

    //private function
    __writeLog(msg, level) {
        let entry = {
            msg: msg,
            level: level,
            timestamp: this.logs.start + new Date().getMilliseconds(),
            source: this.logs.source
        };

        if (this.logs.pool.length >= this.logs.max)
            this.logs.pool = this.logs.pool.splice(1, this.logs.pool.length);

        this.logs.pool.push(entry);

        if (this.logs.onPush !== undefined)
            this.logs.onPush(entry);


        if (this.logs.console) {
            let out = `[${entry.source}][${(entry.timestamp / 1000).toFixed(3)}] ${entry.msg}`;
            if (level === 0)
                console.debug(out);
            else if (level === 1)
                console.info(out);
            else if (level === 2)
                console.warn(out);
            else
                console.log(out);
        }
    }

    //private function
    __rawExpector(self, data) {
        if (data !== undefined) {
            //let str = decodeUTF8(data);

            if (self.shell.chain !== undefined) {
                let ch = self.shell.chain;
                self.shell.chain = undefined;
                self.shell.promise[0]({data, chained: ch});

            } else {
                self.shell.promise[0](data);
            }
        } else {
            if (self.shell.buff.length > 0) {
                let d = self.shell.buff;
                self.shell.buff = new Uint8Array(0);
                this.__promptExpector(self, d)
            }
        }
    }

    //TODO тайматы экспекторов
    //private function
    __promptExpector(self, data) {
        if (data !== undefined) {
            self.shell.buff = new Uint8Array(appendBuffer(self.shell.buff, data));
            self.shell.expector = undefined;
            if (self.shell.buff[0] === StreamControls.PROMPT) {
                self.shell.buff = self.shell.buff.slice(1, self.shell.buff.length);
                if (self.shell.chain !== undefined) {
                    let ch = self.shell.chain;
                    self.shell.chain = undefined;
                    self.shell.promise[0](ch);

                } else {
                    self.shell.promise[0]();
                }
                //self.shell.expectorCallback(true);
            } else {
                self.shell.promise[1]();
                //self.shell.expectorCallback(false);
            }
        } else {
            if (self.shell.buff.length > 0) {
                let d = self.shell.buff;
                self.shell.buff = new Uint8Array(0);
                this.__promptExpector(self, d)
            }
        }
    }

    //private function
    __eopExpector(self, data) {
        if (data !== undefined) {
            self.shell.buff = new Uint8Array(appendBuffer(self.shell.buff, data));
            self.shell.expector = undefined;
            if (self.shell.buff[0] === StreamControls.EOP) {
                if (self.shell.buff.length > 1) {
                    let code = self.shell.buff[1];
                    self.shell.buff = self.shell.buff.slice(2, self.shell.buff.length);
                    //self.shell.promise[0](code);
                    if (self.shell.chain !== undefined) {
                        let ch = self.shell.chain;
                        self.shell.chain = undefined;
                        self.shell.promise[0]({code, chained: ch});

                    } else {
                        self.shell.promise[0](code);
                    }
                    //self.shell.expectorCallback(true, code);
                } else {
                    self.shell.buff = self.shell.buff.slice(1, self.shell.buff.length);
                    self.shell.promise[1]();
                    //self.shell.expectorCallback(true);
                }
            } else {
                self.shell.promise[1]();
            }
        } else {
            if (self.shell.buff.length > 0) {
                let d = self.shell.buff;
                self.shell.buff = new Uint8Array(0);
                this.__eopExpector(self, d)
            }
        }
    }

    //private function
    __readExpector(self, data) {
        if (data !== undefined) {
            let eoiIndex = data.indexOf(StreamControls.EOI);
            if (eoiIndex === -1) {
                self.shell.buff = new Uint8Array(appendBuffer(self.shell.buff, data));
            } else {
                let left = data.slice(0, eoiIndex);
                let right = data.slice(eoiIndex + 1, data.length);
                let str = decodeUTF8(new Uint8Array(appendBuffer(self.shell.buff, left)));
                self.shell.buff = right;
                self.shell.expector = undefined;
                //self.shell.promise[0](str);

                if (self.shell.chain !== undefined) {
                    let ch = self.shell.chain;
                    self.shell.chain = undefined;
                    self.shell.promise[0]({str, chained: ch});

                } else {
                    self.shell.promise[0](str);
                }

                //self.shell.expectorCallback(str);
            }
        } else {
            if (self.shell.buff.length > 0) {
                let d = self.shell.buff;
                self.shell.buff = new Uint8Array(0);
                this.__readExpector(self, d)
            }
        }
    }

    /** Internal realization of the connection logic */
    __createNewConnection(self, address) {
        self.log.info(`Установка соединенния с '${address}' поптыка ${self.shell.connectRetryCounter}...`);
        self.shell.isConnecting = true;
        let connection = new WebSocket(`wss://${address}/shell`);
        connection.binaryType = "arraybuffer";
        connection.onopen = () => {
            this.shell.connectRetryCounter = 0;
            this.shell.connectionStatus = 1;
            self.log.info(`Соединение установлено`);
            this.shell.connectionEstablished(self)
        };

        connection.onclose = () => {
            this.shell.connectionClosed();
            if (self.shell.connectionStatus === 0) {
                self.log.info(`Не удалось установить соединение`);
                setTimeout(() => {
                    this.shell.connectRetryCounter++;
                    self.__createNewConnection(self, address)
                }, 3000);
            } else if (self.shell.connectionStatus === 1) {
                self.log.info(`Соединение сброшено`);
                self.__createNewConnection(self, address);
                this.shell.connectionStatus = 0;
                this.shell.connectRetryCounter++;
            }
        };

        connection.onmessage = (data) => {
            let incom = self.shell.serializer.fromBinary(data.data);
            if (self.shell.expector !== undefined)
                self.shell.expector(self, incom.data)
        };
        self.shell.connection = connection
    }
}
export default ShellModReact;