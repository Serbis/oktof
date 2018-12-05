import React, { Component } from 'react';
import ShellModReact from "../../mod/ShellModReact";
import {Events as CardEvents} from "../../ui/card/Card";
import {eventBus} from "../../index";
import Fsm from "../../utils/Fsm";
import {Events as LogEvents} from "../../offcanvas/log/Log";
import Card from "../../ui/card/Card";
import "./Terminal.css"
import {StreamControls} from "../../utils/StreamControls";
import $ from "jquery";
import {decodeUTF8} from "../../utils/BinaryUtils";
import {Events as MenubarEvents} from "../../ui/menubar/Menubar";
import toastr from "toastr";
import ToastrOptions from "../../libs/toastr/options";
import {getOS} from "../../utils/Environment"

/** The implementation of the terminal page. This component implements the logic of the terminal
 * window, which is a deep superstructure over the textarea. This add-in completely controls the
 * input, saves the history of executed commands and also handles the shell flow control
 * characters
 */
class Terminal extends ShellModReact {

    constructor(props) {
        super(props);

        setTimeout(() => eventBus.publish(MenubarEvents.publisher, MenubarEvents.Actions._setActiveElement, "terminal-page"), 100);

        this.shell.address = "127.0.0.1";
        this.state = { inputText: "" };
        this.logs.source = "terminal";
        this.logs.onPush = this.handleLogPush;

        this.fsm = {
            state: States.Uninitialized
        };

        if (!localStorage.termHistory) {
            localStorage.termHistory = ["echo", "xxx"];
            this.termHistory = localStorage.termHistory.split(",");
            this.termHistoryPointer = 2;
        } else {
            this.termHistory = localStorage.termHistory.split(",");
            this.termHistoryPointer = this.termHistory.length;
        }

        this.handleTerminalKeyDown = this.handleTerminalKeyDown.bind(this);
        this.handleTerminalMouseUp = this.handleTerminalMouseUp.bind(this);
        this.handleTerminalMouseDown = this.handleTerminalMouseDown.bind(this);
        this.handleTerminalInput = this.handleTerminalInput.bind(this);
    }

    /** Start function for establish connection mode */
    when_Est(self) {
        self.startMod();

        //Wait PROMPT from the shell
        self.expectRaw().then(str => { self.processFromShell(self, str) })
    }

    /** Process some input data from the shell */
    processFromShell(self, str) {
        if (self.terminalMode === 0) { //In shell interaction mode
            str.forEach(v => {
                if (v === StreamControls.PROMPT) {
                    let cur = this.terminal.prop("selectionStart");
                    self.setState( { inputText: this.state.inputText + "$ "} );
                    self.inputArea[0] = cur + 2;
                    self.inputArea[1] = cur + 2;
                    self.inputLock = false;
                }
            })
        } else {
            let eop = false;
            str.forEach(v => {
                switch (v) {
                    case StreamControls.PROMPT:
                        let cur0 = this.terminal.prop("selectionStart");
                        self.setState( { inputText: self.state.inputText + "> "} );
                        self.inputArea[0] = cur0 + 2;
                        self.inputArea[1] = cur0 + 2;
                        self.inputLock = false;
                        eop = true;
                        break;
                    case StreamControls.EOI:
                        break;
                    case StreamControls.EOP:
                        let cur = this.terminal.prop("selectionStart");
                        self.setState( { inputText: self.state.inputText + "\n"} );
                        self.inputArea[0] = cur + 1;
                        self.inputArea[1] = cur + 1;
                        self.inputLock = false;
                        self.terminalMode = 0;
                        eop = true;
                        break;
                    default:
                        if (!eop)
                            self.setState( { inputText: self.state.inputText + decodeUTF8(new Uint8Array([v]))});
                        else
                            eop = false;
                }

                self.expectRaw().then(str => { self.processFromShell(self, str) })
            })
        }
    }

    //TODO нормальное положение курсора при работе в середине строки

    //This code for android devices
    /** Handle input from the terminal window for android devices */
    handleTerminalInput(e) {
        //let targetValue = e.target.value;
        let value = e.target.value;
        let diff = value.length - this.state.inputText.length;
        let last = value.charCodeAt(value.length - 1);
        let cur = this.terminal.prop("selectionStart");
        switch (last) {
            case 10:
                //TODO если нажать ввод в середине текста, то просто произойдет перенос строки, см комментарий ниже
                //Код 10 определяется по последнему символу в строке. Его нужно определять по позиции курсора
                let cmd = value.substring(this.inputArea[0], this.inputArea[1]);
                this.termHistory.push(cmd);
                if (this.terminalMode !== 1) {
                    localStorage.termHistory = this.termHistory;
                    this.termHistoryPointer = this.termHistory.length;
                }
                this.setState({inputText: value});
                this.inputLock = true;
                this.terminalMode = 1;
                this.write(cmd);
                this.expectRaw().then(str => { this.processFromShell(this, str) });
                e.preventDefault();
                break;
            default:
                let nt = [value.slice(0, cur), e.key, value.slice(cur)].join('');
                this.setState({inputText: nt});
                this.inputArea[1] = this.inputArea[1] + diff;
        }
    }

    /** Handle input from the terminal window for any os other than android */
    handleTerminalKeyDown(e) {
        if (this.inputLock) {
            e.preventDefault();
        } else {
            let cur = this.terminal.prop("selectionStart");
            let value = this.state.inputText;
            switch (e.keyCode) {
                case 38: //UP
                    let h0;
                    if (this.termHistoryPointer - 1 < 0) {
                        h0 = this.termHistory[this.termHistoryPointer];
                    } else {
                        h0 = this.termHistory[this.termHistoryPointer - 1];
                        this.termHistoryPointer--;
                    }
                    this.setState({inputText: [this.state.inputText.slice(0, this.inputArea[0]), h0, this.inputText.slice(this.inputArea[1])].join("")});
                    this.inputArea[1] = this.inputArea[0] + h0.length;
                    e.preventDefault();
                    break;
                case 40: //DOWN
                    let h1;
                    if (this.termHistoryPointer + 1 > this.termHistory.length) {
                        h1 = "";//this.termHistory[this.termHistoryPointer - 1];
                    } else {
                        h1 = this.termHistory[this.termHistoryPointer];
                        this.termHistoryPointer++;
                    }

                    this.setState({inputText: [this.state.inputText.slice(0, this.inputArea[0]), h1, this.inputText.slice(this.inputArea[1])].join("")});
                    this.inputArea[1] = this.inputArea[0] + h1.length;
                    e.preventDefault();
                    break;
                case 37: //LEFT
                    if (cur <= this.inputArea[0])
                        e.preventDefault();
                    break;
                case 39: //RIGHT
                    if (cur >= this.inputArea[1])
                        e.preventDefault();
                    break;
                case 13: //RETURN
                    //TODO не заносить в историю команду если она была идентичина предидущей
                    let cmd = value.substring(this.inputArea[0], this.inputArea[1]);
                    this.termHistory.push(cmd);
                    if (this.terminalMode !== 1) {
                        localStorage.termHistory = this.termHistory;
                        this.termHistoryPointer = this.termHistory.length;
                    }
                    this.setState({inputText: value + "\n"});
                    this.inputLock = true;
                    this.terminalMode = 1;
                    this.write(cmd);
                    this.expectRaw().then(str => { this.processFromShell(this, str) });
                    e.preventDefault();
                    break;
                case 8: //BACKSPACE
                    if (cur <= this.inputArea[0]) {
                        e.preventDefault();
                    } else {
                        let nt1 = [value.slice(0, cur - 1), value.slice(cur)].join('');
                        this.setState({inputText: nt1});
                        this.inputArea[1]--;
                    }
                    break;
                case 46: //DELETE
                    let nt2 = [value.slice(0, cur), value.slice(cur + 1)].join('');
                    this.setState({inputText: nt2});
                    this.inputArea[1]--;
                    break;
                default:
                    let keycode = e.keyCode;

                    if (keycode === 67 && e.ctrlKey) { //CTRL-C
                        let start = this.terminal.prop("selectionStart");
                        let end = this.terminal.prop("selectionEnd");
                        navigator.clipboard.writeText(this.state.inputText.substring(start, end));
                    } else if (keycode === 86 && e.ctrlKey) { //CTRL-V
                        navigator.clipboard.readText().then(text => {
                            let nt3 = [value.slice(0, cur), text, value.slice(cur)].join('');
                            this.setState({inputText: nt3});
                            this.inputArea[1] = this.inputArea[1] + text.length;
                        })
                    } else { //PRINTABLE CHAR
                        let printable =
                            (keycode > 47 && keycode < 58)   || // number keys
                            keycode === 32                    || // spacebar
                            (keycode > 64 && keycode < 91)   || // letter keys
                            (keycode > 95 && keycode < 112)  || // numpad keys
                            (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
                            (keycode > 218 && keycode < 223);   // [\]' (in order)

                        if (printable) {
                            let nt4 = [value.slice(0, cur), e.key, value.slice(cur)].join('');
                            this.setState({inputText: nt4});
                            this.inputArea[1]++;
                        }
                    }
            }
        }
    }

    /** Control cursor reposition process */
    handleTerminalMouseUp(e) {
        if (!this.inputLock) {
            let cur = this.terminal.prop("selectionStart");
            if (cur < this.inputArea[0]) {
                this.terminal.prop("selectionEnd", this.inputArea[0]);
                this.terminal.prop("selectionStart", this.inputArea[0]);
            }
            if (cur > this.inputArea[1]) {
                this.terminal.prop("selectionEnd", this.inputArea[1]);
                this.terminal.prop("selectionStart", this.inputArea[0]);
            }
        } else {
            e.preventDefault()
        }
    }

    /** Control cursor reposition process */
    handleTerminalMouseDown(e) {
        if (this.inputLock) {
            e.preventDefault()
        }
    }

    /** SellMod log push interceptor */
    handleLogPush(msg) {
        eventBus.publish(LogEvents.publisher, LogEvents.Actions._push, msg);
    }

    /** SellMod ws connected event interceptor */
    shellConnected() {
        toastr.success("Соединение установлено", "", ToastrOptions.Standard);
        eventBus.publish(CardEvents.publisher + "terminal-card", CardEvents.Actions._loaderEnabled, false);
    }

    /** SellMod log push interceptor */
    shellClosed() {
        if (this.connectRetryCounter === 0) {
            toastr.warning("Соединение сброшено", "", ToastrOptions.Standard);
        }
        eventBus.publish(CardEvents.publisher + "terminal-card", CardEvents.Actions._loaderEnabled, true);
    }

    /** Creates os dependent terminal textarea */
    produceTerminal() {
        let os = getOS();
        if (os === "Android")
            return(<textarea onInput={this.handleTerminalInput} onMouseUp={this.handleTerminalMouseUp} onMouseDown={this.handleTerminalMouseDown} name="textarea1" id="terminal" className="form-control" rows="30" placeholder="" value={this.state.inputText}/>);
        else
            return(<textarea onKeyDown={this.handleTerminalKeyDown} onMouseUp={this.handleTerminalMouseUp} onMouseDown={this.handleTerminalMouseDown} name="textarea1" id="terminal" className="form-control" rows="30" placeholder="" value={this.state.inputText}/>);
    }

    /** Initialize terminal properties and start component logic */
    componentDidMount() {
        eventBus.publish(CardEvents.publisher + "terminal-card", CardEvents.Actions._loaderEnabled, true);

        if (this.props.match.params.mode === "est") {
            this.shell.address = this.props.match.params.arg0;
            this.setState( { address: this.shell.address } );
            this.shell.connectionEstablished = this.shellConnected;
            this.shell.connectionClosed = this.shellClosed;

            this.inputArea = [0, 0];
            this.inputText = "";
            this.inputCursor = 0;
            this.terminalMode = 0; //shell
            this.terminal = $("#terminal");
            this.terminal.prop("spellcheck", false);

            this.inputLock = true;

            Fsm.goto(this, States.Est, this.when_Est)
        }
    }
    
    render() {
        return (
            <div>
                <div className="section-header">
                    <ol className="breadcrumb">
                        <li className="active">Терминал</li>
                    </ol>
                </div>
                <div className="section-body">
                    <Card id="terminal-card" header={`Терминал - ${this.state.address}`} >
                        <row>
                            <div className="col-lg-12">
                                { this.produceTerminal() }
                            </div>
                        </row>
                    </Card>
                </div>
            </div>
        );
    }
}

let States = {
    Uninitialized: 0,
    Est: 1
};

export default Terminal;