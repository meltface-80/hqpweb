// Plain TCP for the phone app (hqpmob): HQPlayer's control port (XML lines) and its meter port
// (binary frames). The page's side is apps/mobile src/tcp.ts, which hands it to the
// protocol as a Connect (packages/protocol transport.ts). Bytes cross as base64.
//
// connect({ host, port, timeoutMs }) -> { id, localAddress }; then "data" { id, data } as
// bytes arrive, and "closed" { id, error? } exactly once, however it ends. write({ id, data })
// and close({ id }). Everything runs on one serial queue.
import Capacitor
import Foundation
import Network

@objc(TcpPlugin)
public class TcpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TcpPlugin"
    public let jsName = "Tcp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "hqpweb.tcp")
    /** Open connections by id; only touched on `queue`. */
    private var connections: [String: NWConnection] = [:]

    @objc func connect(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let portNumber = call.getInt("port"),
              let port = NWEndpoint.Port(rawValue: UInt16(clamping: portNumber)) else {
            call.reject("host and port are required")
            return
        }
        let timeoutMs = call.getInt("timeoutMs") ?? 15_000
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let conn = NWConnection(host: NWEndpoint.Host(host), port: port, using: NWParameters(tls: nil, tcp: tcp))
        let id = UUID().uuidString
        var settled = false
        let timeout = DispatchWorkItem {
            guard !settled else { return }
            settled = true
            conn.cancel()
            call.reject("timeout connecting to \(host):\(portNumber)")
        }
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                guard !settled else { return }
                settled = true
                timeout.cancel()
                self.connections[id] = conn
                var local = ""
                if case let .hostPort(h, _)? = conn.currentPath?.localEndpoint { local = "\(h)" }
                call.resolve(["id": id, "localAddress": local])
                self.receive(id, conn)
            case .waiting(let error), .failed(let error):
                // Not reachable now: fail, as a plain socket would, rather than wait for the network.
                if !settled {
                    settled = true
                    timeout.cancel()
                    conn.cancel()
                    call.reject(error.localizedDescription)
                } else {
                    conn.cancel()
                    self.finish(id, error.localizedDescription)
                }
            case .cancelled:
                if settled { self.finish(id, nil) }
            default:
                break
            }
        }
        conn.start(queue: queue)
        queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timeout)
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("id and base64 data are required")
            return
        }
        queue.async {
            guard let conn = self.connections[id] else {
                call.reject("not connected")
                return
            }
            conn.send(content: data, completion: .contentProcessed { error in
                if let error { call.reject(error.localizedDescription) } else { call.resolve() }
            })
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        queue.async {
            self.connections[id]?.cancel() // "closed" follows, from the state handler
            call.resolve()
        }
    }

    private func receive(_ id: String, _ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.notifyListeners("data", data: ["id": id, "data": data.base64EncodedString()])
            }
            if let error {
                conn.cancel()
                self.finish(id, error.localizedDescription)
            } else if isComplete {
                conn.cancel()
                self.finish(id, nil)
            } else {
                self.receive(id, conn)
            }
        }
    }

    /** Once per connection, however it ended. On `queue`. */
    private func finish(_ id: String, _ error: String?) {
        guard connections.removeValue(forKey: id) != nil else { return }
        var event: [String: Any] = ["id": id]
        if let error { event["error"] = error }
        notifyListeners("closed", data: event)
    }
}
