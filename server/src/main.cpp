#include <iostream>
#include <set>
#include <memory>
#include <thread>
#include <chrono>
#include <string>
#include <functional>
#include <map>
#include <mutex>
#include <queue>

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <nlohmann/json.hpp>

#include "GameServer.h"
#include "Player.h"
#include "Mob.h"

using json = nlohmann::json;
using namespace std;

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;

// Forward declarations
class WebSocketServer;

class WebSocketSession : public std::enable_shared_from_this<WebSocketSession> {
public:
    WebSocketSession(tcp::socket socket, WebSocketServer* server);
    void start();
    void send(const string& message);

private:
    void read();
    void on_send(std::shared_ptr<const std::string> ss);
    void on_write(beast::error_code ec, std::size_t bytes_transferred);

    websocket::stream<tcp::socket> m_ws;
    beast::flat_buffer m_buffer;
    WebSocketServer* m_server;
    std::queue<std::shared_ptr<const std::string>> m_write_queue;
};

class WebSocketServer {
public:
    WebSocketServer() : m_gameServer(std::make_unique<GameServer>()) {
        cout << "WebSocket server initialized" << endl;
    }
    
    ~WebSocketServer() {
        if (m_gameThread.joinable()) {
            m_gameThread.join();
        }
    }

    void run(uint16_t port) {
        m_ioc = std::make_unique<net::io_context>();
        
        // Create acceptor
        m_acceptor = std::make_unique<tcp::acceptor>(*m_ioc, tcp::endpoint(tcp::v4(), port));
        
        cout << "Server listening on port " << port << endl;
        
        // Start game loop in separate thread
        m_gameThread = std::thread([this]() {
            gameLoop();
        });
        
        // Start accepting connections
        startAccept();
        
        // Run the io_context
        m_ioc->run();
    }

    void handleMessage(std::shared_ptr<WebSocketSession> session, const string& message) {
        try {
            json data = json::parse(message);
            string type = data["type"];
            
            cout << "Received message type: " << type << endl;
            cout.flush();
            
            if (type == "playerJoin") {
                handlePlayerJoin(session, data["data"]);
            } else if (type == "playerUpdate") {
                handlePlayerUpdate(session, data["data"]);
            } else if (type == "mousePosition") {
                cout << "Handling mousePosition message" << endl;
                cout.flush();
                handleMousePosition(session, data["data"]);
            } else if (type == "damage") {
                handleDamage(session, data["data"]);
            } else if (type == "canvasDimensions") {
                handleCanvasDimensions(session, data["data"]);
            }
        } catch (const exception& e) {
            cerr << "Error parsing message: " << e.what() << endl;
        }
    }

    void removeSession(std::shared_ptr<WebSocketSession> session) {
        std::string playerId;
        std::vector<std::shared_ptr<WebSocketSession>> sessionsToNotify;
        {
            std::lock_guard<std::mutex> lock(m_sessionsMutex);
            auto it = m_playerSessions.find(session);
            if (it != m_playerSessions.end()) {
                playerId = it->second;
                m_playerSessions.erase(it);
            }
            m_sessions.erase(session);

            // Copy the remaining sessions to notify them
            sessionsToNotify.assign(m_sessions.begin(), m_sessions.end());
        }

        if (!playerId.empty()) {
            m_gameServer->removePlayer(playerId);

            json message;
            message["type"] = "playerLeave";
            message["data"]["playerId"] = playerId;
            std::string serialized_message = message.dump();

            for (auto& s : sessionsToNotify) {
                s->send(serialized_message);
            }
        }
    }

    void broadcast(const string& message, std::shared_ptr<WebSocketSession> exclude = nullptr) {
        // Copy sessions under lock, then send outside lock
        std::vector<std::shared_ptr<WebSocketSession>> sessionsCopy;
        {
            std::lock_guard<std::mutex> lock(m_sessionsMutex);
            sessionsCopy.assign(m_sessions.begin(), m_sessions.end());
        }
        for (auto& session : sessionsCopy) {
            if (session != exclude) {
                session->send(message);
            }
        }
    }

private:
    void startAccept() {
        auto socket = std::make_shared<tcp::socket>(*m_ioc);
        m_acceptor->async_accept(*socket,
            [this, socket](beast::error_code ec) {
                if (!ec) {
                    // Create new session
                    auto session = std::make_shared<WebSocketSession>(std::move(*socket), this);
                    {
                        std::lock_guard<std::mutex> lock(m_sessionsMutex);
                        m_sessions.insert(session);
                    }
                    session->start();
                    
                    // Continue accepting connections
                    startAccept();
                } else {
                    cerr << "Error accepting connection: " << ec.message() << endl;
                }
            });
    }

    void handlePlayerJoin(std::shared_ptr<WebSocketSession> session, const json& data) {
        string playerId = data["playerId"];
        m_playerSessions[session] = playerId;
        
        // Create new player
        auto player = m_gameServer->addPlayer(playerId);
        
        // Send current game state to new player
        json gameState;
        gameState["type"] = "gameState";
        gameState["data"] = m_gameServer->getGameState();
        
        session->send(gameState.dump());
        
        // Notify other clients about new player
        json message;
        message["type"] = "playerJoin";
        message["data"] = player->toJson();
        broadcast(message.dump(), session);
    }

    void handlePlayerUpdate(std::shared_ptr<WebSocketSession> session, const json& data) {
        auto it = m_playerSessions.find(session);
        if (it != m_playerSessions.end()) {
            string playerId = it->second;
            m_gameServer->updatePlayer(playerId, data);
        }
    }

    void handleMousePosition(std::shared_ptr<WebSocketSession> session, const json& data) {
        auto it = m_playerSessions.find(session);
        if (it != m_playerSessions.end()) {
            string playerId = data["playerId"];
            float mouseX = data["mouseX"];
            float mouseY = data["mouseY"];
            cout << "Mouse position update for player " << playerId << ": (" << mouseX << ", " << mouseY << ")" << endl;
            cout.flush();
            m_gameServer->updatePlayerMousePosition(playerId, mouseX, mouseY);
        } else {
            cout << "Session not found for mouse position update" << endl;
            cout.flush();
        }
    }

    void handleDamage(std::shared_ptr<WebSocketSession> session, const json& data) {
        string mobId = data["mobId"];
        int damage = data["damage"];
        string playerId = data["playerId"];
        
        if (m_gameServer->damageMob(mobId, damage)) {
            // Mob was destroyed
            json message;
            message["type"] = "mobUpdate";
            message["data"] = m_gameServer->getMobsJson();
            broadcast(message.dump());
        }
    }

    void handleCanvasDimensions(std::shared_ptr<WebSocketSession> session, const json& data) {
        auto it = m_playerSessions.find(session);
        if (it != m_playerSessions.end()) {
            string playerId = data["playerId"];
            float width = data["width"];
            float height = data["height"];
            cout << "Canvas dimensions update for player " << playerId << ": (" << width << ", " << height << ")" << endl;
            cout.flush();
            m_gameServer->updatePlayerCanvasDimensions(playerId, width, height);
        } else {
            cout << "Session not found for canvas dimensions update" << endl;
            cout.flush();
        }
    }

    void gameLoop() {
        const auto targetFrameTime = std::chrono::milliseconds(16); // ~60 FPS
        
        cout << "Game loop started" << endl;
        cout.flush();
        
        while (true) {
            auto frameStart = std::chrono::steady_clock::now();
            
            cout << "Game loop iteration" << endl;
            cout.flush();
            
            // Update game state
            m_gameServer->update();
            
            // Only broadcast if there are connected clients
            bool hasClients = false;
            {
                std::lock_guard<std::mutex> lock(m_sessionsMutex);
                hasClients = !m_sessions.empty();
            }
            
            if (hasClients) {
                json message;
                message["type"] = "gameState";
                message["data"] = m_gameServer->getGameState();
                broadcast(message.dump());
            }
            
            // Sleep to maintain frame rate
            auto frameEnd = std::chrono::steady_clock::now();
            auto frameTime = frameEnd - frameStart;
            if (frameTime < targetFrameTime) {
                std::this_thread::sleep_for(targetFrameTime - frameTime);
            }
        }
    }

    friend class WebSocketSession;
    
    std::unique_ptr<net::io_context> m_ioc;
    std::unique_ptr<tcp::acceptor> m_acceptor;
    std::set<std::shared_ptr<WebSocketSession>> m_sessions;
    std::map<std::shared_ptr<WebSocketSession>, string> m_playerSessions;
    std::mutex m_sessionsMutex;
    std::unique_ptr<GameServer> m_gameServer;
    std::thread m_gameThread;
};

// WebSocketSession method implementations
WebSocketSession::WebSocketSession(tcp::socket socket, WebSocketServer* server)
    : m_ws(std::move(socket)), m_server(server) {
}

void WebSocketSession::start() {
    // Set suggested timeout settings for the websocket
    m_ws.set_option(
        websocket::stream_base::timeout::suggested(
            beast::role_type::server));

    // Set a decorator to change the Server of the handshake
    m_ws.set_option(websocket::stream_base::decorator(
        [](websocket::response_type& res) {
            res.set(http::field::server,
                std::string(BOOST_BEAST_VERSION_STRING) +
                    " websocket-server-async");
        }));
    
    // Configure permessage-deflate
    websocket::permessage_deflate pmd;
    pmd.client_enable = true; // Allow clients to negotiate compression
    pmd.server_enable = true; // Enable compression on the server
    // The server should not mask frames it sends to the client
    pmd.server_no_context_takeover = true; 
    pmd.client_no_context_takeover = true;
    m_ws.set_option(pmd);


    // Accept the WebSocket handshake
    m_ws.async_accept([self = shared_from_this()](beast::error_code ec) {
        if (!ec) {
            std::cout << "WebSocket connection accepted" << std::endl;
            self->read();
        } else {
            std::cerr << "WebSocket handshake failed: " << ec.message() << std::endl;
        }
    });
}

void WebSocketSession::send(const string& message) {
    net::post(m_ws.get_executor(),
        [self = shared_from_this(), msg = std::make_shared<const std::string>(message)]() {
            self->on_send(msg);
        });
}

void WebSocketSession::on_send(std::shared_ptr<const std::string> ss) {
    m_write_queue.push(ss);

    if(m_write_queue.size() > 1) {
        return; // Already writing
    }

    m_ws.async_write(
        net::buffer(*m_write_queue.front()),
        [self = shared_from_this()](beast::error_code ec, std::size_t bytes) {
            self->on_write(ec, bytes);
        }
    );
}

void WebSocketSession::on_write(beast::error_code ec, std::size_t bytes_transferred) {
    boost::ignore_unused(bytes_transferred);

    if(ec) {
        std::cerr << "write error: " << ec.message() << std::endl;
        return;
    }

    m_write_queue.pop();

    if(!m_write_queue.empty()) {
        m_ws.async_write(
            net::buffer(*m_write_queue.front()),
            [self = shared_from_this()](beast::error_code ec, std::size_t bytes) {
                self->on_write(ec, bytes);
            }
        );
    }
}

void WebSocketSession::read() {
    m_ws.async_read(
        m_buffer,
        [self = shared_from_this()](beast::error_code ec, std::size_t bytes_transferred) {
            if (!ec) {
                try {
                    string message = beast::buffers_to_string(self->m_buffer.data());
                    self->m_buffer.consume(self->m_buffer.size());
                    
                    cout << "Raw message received: " << message << endl;
                    cout.flush(); // Force output
                    
                    // Handle message
                    self->m_server->handleMessage(self, message);
                    
                    // Continue reading
                    self->read();
                } catch (const std::exception& e) {
                    std::cerr << "Error processing message: " << e.what() << std::endl;
                    cout.flush();
                    self->m_server->removeSession(self);
                }
            } else {
                // Connection closed
                std::cout << "WebSocket connection closed: " << ec.message() << std::endl;
                self->m_server->removeSession(self);
            }
        });
}

int main() {
    try {
        WebSocketServer server;
        server.run(8080);
    } catch (const exception& e) {
        cerr << "Error: " << e.what() << endl;
        return 1;
    }
    
    return 0;
} 