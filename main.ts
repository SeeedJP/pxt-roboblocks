enum RoboBlocksConnector {
    //% block="P0/P14"
    P00P14,
    //% block="P1/P15"
    P01P15,
    //% block="P2/P16"
    P02P16
}

/**
 * Robo Blocksカスタムブロック
 */
//% block="Robo Blocks"
//% color=#4c97fe weight=1 icon="\u21cc" advanced=true
namespace RoboBlocks {

    const RX_BUFFER_SIZE = 100;                 // UART受信バッファサイズ
    const START_CHAR = '*';                     // UART開始文字
    const END_CHAR = '\n';                      // UART終了文字

    const POLLING_INTERVAL = 1;                 // ポーリング周期[msec.]

    const GROVE_WIFI_GET_TOKEN_TIMEOUT = 30000; // GroveWiFiトークン取得タイムアウト[msec.]
    const GROVE_WIFI_READ_TIMEOUT = 60000;      // GroveWiFi受信タイムアウト[msec.]

    const DO_WORK_INTERVAL = 500;               // バックグラウンド実行周期[msec.]
    const WIFI_CONNECT_TIMEOUT = 30000;         // WiFi接続タイムアウト[msec.]

    const SERVER_URI = "wss://blocks.softbankrobotics.com/ws";  // サーバーURI
    const SERVER_GET_TOKEN_TIMEOUT = 30000;     // サーバー通信トークン取得タイムアウト[msec.]
    const SERVER_MESSAGE_TIMEOUT = 5000;        // サーバーメッセージ受信タイムアウト[msec.]
    const MIN_SEND_VALUE_INTERVAL = 1000;       // データ送信最小周期[msec.]

    ////////////////////////////////////////////////////////////////////////////////
    // Helper functions

    function StringIndexOf(str: string, key: string, index: number): number {
        if (index == 0) {
            return str.indexOf(key);
        }
        else {
            let i = str.substr(index, str.length).indexOf(key);
            if (i >= 0) i += index;
            return i;
        }
    }

    function StringReplace(str: string, fromStr: string, toStr: string): string {
        let i = 0;
        while ((i = StringIndexOf(str, fromStr, i)) >= 0) {
            str = str.substr(0, i) + toStr + str.substr(i + fromStr.length, str.length);
            i += toStr.length;
        }
        return str;
    }

    function ItemEncode(str: string): string {
        let str2 = "";

        for (let i = 0; i < str.length; i++) {
            if (str[i] === '\\') str2 += "\\\\";
            else if (str[i] === '*') str2 += "\\s";
            else if (str[i] === '\n') str2 += "\\n";
            else if (str[i] === ',') str2 += "\\c";
            else str2 += str[i];
        }

        return str2;
    }

    function ItemDecode(str: string): string {
        let str2 = "";

        for (let i = 0; i < str.length; i++) {
            if (str[i] === '\\') {
                if (++i >= str.length) break;
                if (str[i] === '\\') str2 += '\\';
                else if (str[i] === 's') str2 += '*';
                else if (str[i] === 'n') str2 += '\n';
                else if (str[i] === 'c') str2 += ',';
            }
            else {
                str2 += str[i];
            }
        }

        return str2;
    }

    function ParseServerMessage(str: string): { [key: string]: string; } {
        let message: { [key: string]: string; } = {};

        let lines = str.split('\n');
        for (let i = 0; i < lines.length; i++) {
            let items = lines[i].split('\t');
            if (items.length === 2) {
                message[items[0]] = items[1];
            }
        }

        return message;
    }

    ////////////////////////////////////////////////////////////////////////////////
    // SerialInterface

    namespace SerialInterface {

        let AttachedDataReceived = false;
        let ReceivedData: string[] = undefined;

        function DataReceived(): void {
            let str = serial.readUntil(serial.delimiters(Delimiters.NewLine));

            let startIndex = StringIndexOf(str, START_CHAR, 0);
            if (startIndex < 0) return;
            {
                let i: number;
                while ((i = StringIndexOf(str, START_CHAR, startIndex + 1)) >= 0) {
                    startIndex = i;
                }
            }
            str = str.substr(startIndex + 1, str.length);
            if (str.length >= 1) {
                if (str.charAt(str.length - 1) === END_CHAR) {
                    str = str.substr(0, str.length - 1);
                }
            }

            // Debug print
            //serial.writeString(str);

            if (ReceivedData !== undefined) return;
            ReceivedData = str.split(',');
            for (let i = 0; i < ReceivedData.length; i++) {
                ReceivedData[i] = ItemDecode(ReceivedData[i]);
            }
        }

        export function Write(items: string[]): void {
            for (let i = 0; i < items.length; i++) {
                items[i] = ItemEncode(items[i]);
            }
            serial.writeString(START_CHAR + items.join(',') + END_CHAR);
        }

        export function PreRead(): void {
            if (!AttachedDataReceived) {
                serial.onDataReceived(serial.delimiters(Delimiters.NewLine), DataReceived);
                AttachedDataReceived = true;
            }

            ReceivedData = undefined;
        }

        export function Read(): string[] {
            let startTime = input.runningTime();
            while (ReceivedData === undefined) {
                if (input.runningTime() >= startTime + GROVE_WIFI_READ_TIMEOUT) control.panic(102);
                basic.pause(POLLING_INTERVAL);
            }

            return ReceivedData;
        }

    }

    ////////////////////////////////////////////////////////////////////////////////
    // SerialInterface

    namespace GroveWiFi {

        let Token = true;

        function GetToken(): void {
            let startTime = input.runningTime();
            while (!Token) {
                if (input.runningTime() >= startTime + GROVE_WIFI_GET_TOKEN_TIMEOUT) control.panic(101);
                basic.pause(POLLING_INTERVAL);
            }

            Token = false;
        }

        function ReturnToken(): void {
            Token = true;
        }

        export function WiFiStatus(): number {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["wifi_status"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 2) control.panic(0);
            if (res[0] !== "ok") control.panic(1);

            return parseInt(res[1]);
        }

        export function WiFiConnect(ssid: string, password: string): void {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["wifi_connect", ssid, password]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(2);
            if (res[0] !== "ok") control.panic(3);
        }

        export function WiFiDisconnect(): void {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["wifi_disconnect"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(4);
            if (res[0] !== "ok") control.panic(5);
        }

        export function WiFiIsConnected(): boolean {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["wifi_isconnected"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 2) control.panic(6);
            if (res[0] !== "ok") control.panic(7);

            return res[1] !== "0";
        }

        export function WsSecurity(): void {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_security", "insecure"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(8);
            if (res[0] !== "ok") control.panic(9);
        }

        export function WsConnect(url: string): boolean {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_connect", url]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(10);
            if (res[0] === "connect_error") {
                ReturnToken();
                return false;
            }
            if (res[0] !== "ok") control.panic(11);

            return true;
        }

        export function WsClose(): void {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_close"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(12);
            if (res[0] !== "ok") control.panic(13);
        }

        export function WsSend(str: string): void {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_send", str.length.toString(), str]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 1) control.panic(14);
            if (res[0] !== "ok") control.panic(15);
        }

        export function WsReceivedCount(): number {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_receivedcount"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length !== 2) control.panic(16);
            if (res[0] !== "ok") control.panic(17);

            return parseInt(res[1]);
        }

        export function WsReceive(): string {
            GetToken();
            SerialInterface.PreRead();
            SerialInterface.Write(["ws_receive"]);
            let res = SerialInterface.Read();
            ReturnToken();

            if (res.length < 1) control.panic(18);
            if (res[0] === "not_received") return undefined;
            if (res[0] !== "ok") control.panic(19);
            if (res.length !== 3) control.panic(20);

            return res[2];
        }

    }

    ////////////////////////////////////////////////////////////////////////////////
    // RoboBlocksController

    enum RoboBlocksControllerState {
        WiFiDisconnected,
        WiFiConnecting,
        WiFiConnected,
        ServerConnected,
    }

    class RoboBlocksController {

        private State: RoboBlocksControllerState;
        private StateChangedTime: number;
        private ServerReceiveToken: boolean;
        private RobotPaired: boolean;
        private SendValueTime: number;

        private ValueTemperature: number;
        private ValueLightLevel: number;
        private ValueCompassHeading: number;
        private ValueAccelerometerX: number;
        private ValueAccelerometerY: number;
        private ValueAccelerometerZ: number;
        private ValueAccelerometerA: number;
        private NameCustomMessage: string;
        private ValueCustomMessage: number;

        private WiFiConnectedSuccessHandler: () => void;
        private WiFiConnectedFailHandler: () => void;
        private WiFiDisconnectedHandler: () => void;
        private ServerConnectedSuccessHandler: () => void;
        private ServerConnectedFailHandler: () => void;
        private ServerDisconnectedHandler: () => void;
        private RobotConnectedHandler: () => void;
        private RobotDisconnectedHandler: () => void;

        private ClearValues() {
            this.ValueTemperature = undefined;
            this.ValueLightLevel = undefined;
            this.ValueCompassHeading = undefined;
            this.ValueAccelerometerX = undefined;
            this.ValueAccelerometerY = undefined;
            this.ValueAccelerometerZ = undefined;
            this.ValueAccelerometerA = undefined;
            this.NameCustomMessage = undefined;
            this.ValueCustomMessage = undefined;
        }

        private ServerGetReceiveToken() {
            let startTime = input.runningTime();
            while (!this.ServerReceiveToken) {
                if (input.runningTime() >= startTime + SERVER_GET_TOKEN_TIMEOUT) control.panic(100);
                basic.pause(POLLING_INTERVAL);
            }

            this.ServerReceiveToken = false;
        }

        private ServerReturnReceiveToken() {
            this.ServerReceiveToken = true;
        }

        private ServerSendAndReceiveMessage(str: string, messageType: string, timeout: number): { [key: string]: string; } {
            this.ServerGetReceiveToken();   // GET TOKEN

            if (str !== undefined) GroveWiFi.WsSend(str);

            let startTime = input.runningTime();
            while (true) {
                let str = GroveWiFi.WsReceive();
                if (str !== undefined) {
                    let message = ParseServerMessage(str);
                    if (messageType !== undefined && message["message_type"] === messageType) {
                        this.ServerReturnReceiveToken();    // RETURN TOKEN
                        return message;
                    }
                    else if (message["message_type"] === "pairDevice") {
                        if (this.RobotConnectedHandler) this.RobotConnectedHandler();
                        this.RobotPaired = true;
                        continue;
                    }
                    else if (message["message_type"] === "unpairDevice") {
                        this.RobotPaired = false;
                        if (this.RobotDisconnectedHandler) this.RobotDisconnectedHandler();
                        continue;
                    }
                }

                if (input.runningTime() >= startTime + timeout) break;
                basic.pause(POLLING_INTERVAL);
            }

            this.ServerReturnReceiveToken();    // RETURN TOKEN

            return undefined;
        }

        private IsWiFiConnected(): boolean {
            return GroveWiFi.WiFiIsConnected();
        }

        private ChangeStateAndCallHandler(state: RoboBlocksControllerState, handler: () => void) {
            this.State = state;
            this.StateChangedTime = input.runningTime();
            if (handler) handler();
        }

        constructor() {
            serial.setRxBufferSize(RX_BUFFER_SIZE);
            this.ServerReceiveToken = true;
            this.RobotPaired = false;
            this.SendValueTime = input.runningTime();

            this.ClearValues();

            this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiDisconnected, null);

            control.inBackground(() => {
                while (true) {
                    this.DoWork();
                    basic.pause(DO_WORK_INTERVAL);
                }
            });
        }

        DoWork() {
            switch (this.State) {
                case RoboBlocksControllerState.WiFiDisconnected:
                    break;
                case RoboBlocksControllerState.WiFiConnecting:
                    if (input.runningTime() >= this.StateChangedTime + WIFI_CONNECT_TIMEOUT) {
                        this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiDisconnected, this.WiFiConnectedFailHandler);
                    }
                    else if (this.IsWiFiConnected()) {
                        this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiConnected, this.WiFiConnectedSuccessHandler);
                    }
                    break;
                case RoboBlocksControllerState.WiFiConnected:
                    if (!this.IsWiFiConnected()) {
                        this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiDisconnected, this.WiFiDisconnectedHandler);
                    }
                    break;
                case RoboBlocksControllerState.ServerConnected:
                    if (!this.IsWiFiConnected()) {
                        this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiDisconnected, this.WiFiDisconnectedHandler);
                    }
                    else {
                        this.ServerSendAndReceiveMessage(undefined, undefined, 0);
                    }
                    break;
            }
        }

        WiFiConnect(ssid: string, password: string) {
            GroveWiFi.WiFiConnect(ssid, password);

            this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiConnecting, null);
        }

        WiFiConnectedSuccess(handler: () => void) {
            this.WiFiConnectedSuccessHandler = handler;
        }

        WiFiConnectedFail(handler: () => void) {
            this.WiFiConnectedFailHandler = handler;
        }

        WiFiDisconnected(handler: () => void) {
            this.WiFiDisconnectedHandler = handler;
        }

        ConnectServer(room: string, password: string, user: string) {
            if (this.State !== RoboBlocksControllerState.WiFiConnected &&
                this.State !== RoboBlocksControllerState.ServerConnected) {
                return;
            }

            GroveWiFi.WsSecurity();
            if (!GroveWiFi.WsConnect(SERVER_URI)) {
                this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiConnected, this.ServerConnectedFailHandler);
                return;
            }
            let message = this.ServerSendAndReceiveMessage(
                "message_type\tlogin\n" +
                "device_type\tmicrobit\n" +
                "room_name\t" + room + "\n" +
                "room_pass\t" + password + "\n" +
                "user_name\t" + user
                , "login", SERVER_MESSAGE_TIMEOUT);
            if (message === undefined || message["result"] !== "000") {
                GroveWiFi.WsClose();
                this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiConnected, this.ServerConnectedFailHandler);
                return;
            }

            this.RobotPaired = false;
            this.ChangeStateAndCallHandler(RoboBlocksControllerState.ServerConnected, this.ServerConnectedSuccessHandler);
        }

        ServerConnectedSuccess(handler: () => void) {
            this.ServerConnectedSuccessHandler = handler;
        }

        ServerConnectedFail(handler: () => void) {
            this.ServerConnectedFailHandler = handler;
        }

        ServerDisconnect() {
            if (this.State !== RoboBlocksControllerState.WiFiConnected &&
                this.State !== RoboBlocksControllerState.ServerConnected) {
                return;
            }

            if (this.State === RoboBlocksControllerState.ServerConnected) {
                let message = this.ServerSendAndReceiveMessage("message_type\tlogout", "logout", SERVER_MESSAGE_TIMEOUT);
                if (message === undefined || message["result"] !== "000") {
                    // Nothing
                }
            }
            GroveWiFi.WsClose();

            this.ChangeStateAndCallHandler(RoboBlocksControllerState.WiFiConnected, this.ServerDisconnectedHandler);
        }

        ServerDisconnected(handler: () => void) {
            this.ServerDisconnectedHandler = handler;
        }

        RobotConnected(handler: () => void) {
            this.RobotConnectedHandler = handler;
        }

        RobotDisconnect() {
            if (this.State !== RoboBlocksControllerState.ServerConnected) {
                return;
            }

            let message = this.ServerSendAndReceiveMessage("message_type\tunpairDevice", undefined, 0);
        }

        RobotDisconnected(handler: () => void) {
            this.RobotDisconnectedHandler = handler;
        }

        IsRobotConnected(): boolean {
            if (this.State !== RoboBlocksControllerState.ServerConnected) {
                return false;
            }

            return this.RobotPaired;
        }

        SetValue(key: string, value: number) {
            switch (key) {
                case "temp":
                    this.ValueTemperature = value;
                    break;
                case "brightness":
                    this.ValueLightLevel = value;
                    break;
                case "compass":
                    this.ValueCompassHeading = value;
                    break;
                case "accX":
                    this.ValueAccelerometerX = value;
                    break;
                case "accY":
                    this.ValueAccelerometerY = value;
                    break;
                case "accZ":
                    this.ValueAccelerometerZ = value;
                    break;
                case "accA":
                    this.ValueAccelerometerA = value;
                    break;
                default:
                    this.NameCustomMessage = key;
                    this.ValueCustomMessage = value;
                    break;
            }
        }

        SendValue() {
            if (this.State !== RoboBlocksControllerState.ServerConnected) {
                return;
            }

            while (input.runningTime() < this.SendValueTime + MIN_SEND_VALUE_INTERVAL) {
                basic.pause(POLLING_INTERVAL);
            }
            this.SendValueTime = input.runningTime();

            let str =
                "message_type\taction\n" +
                "device_type\tmicrobit\n" +
                "event\tSENSOR\n";

            if (this.ValueTemperature !== undefined) str += "roboMicrobitTemperature\t" + this.ValueTemperature.toString() + "\n";
            if (this.ValueLightLevel !== undefined) str += "roboMicrobitLightLevel\t" + this.ValueLightLevel.toString() + "\n";
            if (this.ValueCompassHeading !== undefined) str += "roboMicrobitCompassHeading\t" + this.ValueCompassHeading.toString() + "\n";
            if (this.ValueAccelerometerX !== undefined) str += "roboMicrobitAccelerometerX\t" + this.ValueAccelerometerX.toString() + "\n";
            if (this.ValueAccelerometerY !== undefined) str += "roboMicrobitAccelerometerY\t" + this.ValueAccelerometerY.toString() + "\n";
            if (this.ValueAccelerometerZ !== undefined) str += "roboMicrobitAccelerometerZ\t" + this.ValueAccelerometerZ.toString() + "\n";
            if (this.ValueAccelerometerA !== undefined) str += "roboMicrobitAccelerometerA\t" + this.ValueAccelerometerA.toString() + "\n";
            if (this.ValueCustomMessage !== undefined) str += "roboMicrobitCustomMessage\t" + this.NameCustomMessage + ":" + this.ValueCustomMessage.toString() + "\n";

            if (str.length >= 1) {
                if (str.charAt(str.length - 1) === "\n") {
                    str = str.substr(0, str.length - 1);
                }
            }

            let message = this.ServerSendAndReceiveMessage(str, "ACK", 0);
            if (message === undefined) {
                return;
            }

            this.ClearValues();
        }

    }

    let Controller = new RoboBlocksController();

    ////////////////////////////////////////////////////////////////////////////////
    // RoboBlocks

    /**
     * Select a Grove Shield port for the wireless communication.
     */
    //% block="Wi-Fi communication at|%connector"
    export function WiringGroveWiFi(connector: RoboBlocksConnector): void {
        switch (connector) {
            case RoboBlocksConnector.P00P14:
                serial.redirect(SerialPin.P14, SerialPin.P0, BaudRate.BaudRate9600);
                break;
            case RoboBlocksConnector.P01P15:
                serial.redirect(SerialPin.P15, SerialPin.P1, BaudRate.BaudRate9600);
                break;
            case RoboBlocksConnector.P02P16:
                serial.redirect(SerialPin.P16, SerialPin.P2, BaudRate.BaudRate9600);
                break;
        }
    }

    /**
     * Connect to a wireless network with specified SSID and password.
     */
    //% block="connect to Wi-Fi|SSID%ssid|password%password"
    export function ConnectWiFi(ssid: string, password: string): void {
        Controller.WiFiConnect(ssid, password);
    }

    /**
     * Run code when the micro:bit gets connected to a wireless network.
     */
    //% block="on Wi-Fi connected"
    export function ConnectedWiFiSuccess(handler: () => void) {
        Controller.WiFiConnectedSuccess(handler);
    }

    /**
     * Run code when the micro:bit cannot connect to a wireless network.
     */
    //% block="on failed to connect to Wi-Fi"
    export function ConnectedWiFiFail(handler: () => void) {
        Controller.WiFiConnectedFail(handler);
    }

    /**
     * Run code when the micro:bit has lost connection with the wireless network.
     */
    //% block="on Wi-Fi disconnected"
    export function DisconnectedWiFiSuccess(handler: () => void) {
        Controller.WiFiDisconnected(handler);
    }

    /**
     * Login to a room of Robo Blocks with specified information.
     */
    //% block="login|Room name%room|Room password%password|Your name%user"
    export function ConnectServer(room: string, password: string, user: string): void {
        Controller.ConnectServer(room, password, user);
    }

    /**
     * Run code when the micro:bit gets logged in to the room.
     */
    //% block="on login succeeded"
    export function ConnectedServerSuccess(handler: () => void) {
        Controller.ServerConnectedSuccess(handler);
    }

    /**
     * Run code when the micro:bit cannot login to the room.
     */
    //% block="on login failed"
    export function ConnectedServerFail(handler: () => void) {
        Controller.ServerConnectedFail(handler);
    }

    /**
     * Log out from the room.
     */
    //% block="logout"
    export function DisconnectServer(): void {
        Controller.ServerDisconnect();
    }

    /**
     * Run code when the micro:bit has logged out from the room.
     */
    //% block="on logout"
    export function DisconnectedServer(handler: () => void) {
        Controller.ServerDisconnected(handler);
    }

    /**
     * Run code when the micro:bit gets connected to a robot.
     */
    //% block="on robot connected"
    export function ConnectedRobot(handler: () => void) {
        Controller.RobotConnected(handler);
    }

    /**
     * Run code when the micro:bit has lost connection with the robot.
     */
    //% block="on robot disconnected"
    export function DisconnectedRobot(handler: () => void) {
        Controller.RobotDisconnected(handler);
    }

    /**
     * Disconnect the micro:bit from the robot.
     */
    //% block="disconnect from robot"
    export function DisconnectRobot(): void {
        Controller.RobotDisconnect();
    }

    /**
     * Reports true if the micro:bit is connected to the robot.
     */
    //% block="is robot connected"
    export function IsConnectedRobot(): boolean {
        return Controller.IsRobotConnected();
    }

    /**
     * Define an identifier (key name) and a value(s) of data to send.
     */
    //% block="set name and value of data|key name%name|value%value"
    export function SetValue(key: string, value: number): void {
        Controller.SetValue(key, value);
    }

    /**
     * Send the data to the connected robot.
     */
    //% block="send data to robot"
    export function SendValue(): void {
        Controller.SendValue();
    }

}
