#include "Player.h"
#include <iostream>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

Player::Player(const std::string& id) 
    : m_id(id)
    , m_position(400, 300)
    , m_velocity(0, 0)
    , m_health(100)
    , m_maxHealth(100)
    , m_radius(20.0f)
    , m_color("#3498db")
{
    initializeOrbitingCircles();
}

Player::~Player() {
    // Destructor
}

void Player::initializeOrbitingCircles() {
    m_orbitingCircles.clear();
    
    const std::vector<std::string> colors = {
        "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"
    };
    
    for (int i = 0; i < 5; ++i) {
        float angle = (i * 2.0f * M_PI) / 5.0f;
        m_orbitingCircles.emplace_back(angle, 8.0f, 60.0f, colors[i]);
    }
}

void Player::takeDamage(int damage) {
    m_health = std::max(0, m_health - damage);
    if (m_health <= 0) {
        std::cout << "Player " << m_id << " has died!" << std::endl;
    }
}

void Player::heal(int amount) {
    m_health = std::min(m_maxHealth, m_health + amount);
}

void Player::updateOrbitingCircles(float deltaTime) {
    const float rotationSpeed = 2.0f; // radians per second
    
    for (auto& circle : m_orbitingCircles) {
        circle.angle += rotationSpeed * deltaTime;
        if (circle.angle > 2.0f * M_PI) {
            circle.angle -= 2.0f * M_PI;
        }
    }
}

json Player::toJson() const {
    json playerJson;
    playerJson["id"] = m_id;
    playerJson["position"]["x"] = m_position.x;
    playerJson["position"]["y"] = m_position.y;
    playerJson["velocity"]["x"] = m_velocity.x;
    playerJson["velocity"]["y"] = m_velocity.y;
    playerJson["health"] = m_health;
    playerJson["maxHealth"] = m_maxHealth;
    playerJson["radius"] = m_radius;
    playerJson["color"] = m_color;
    
    // Serialize orbiting circles
    playerJson["orbitingCircles"] = json::array();
    for (const auto& circle : m_orbitingCircles) {
        json circleJson;
        circleJson["angle"] = circle.angle;
        circleJson["radius"] = circle.radius;
        circleJson["orbitRadius"] = circle.orbitRadius;
        circleJson["color"] = circle.color;
        playerJson["orbitingCircles"].push_back(circleJson);
    }
    
    return playerJson;
}

void Player::fromJson(const json& data) {
    if (data.contains("position")) {
        m_position.x = data["position"]["x"];
        m_position.y = data["position"]["y"];
    }
    
    if (data.contains("velocity")) {
        m_velocity.x = data["velocity"]["x"];
        m_velocity.y = data["velocity"]["y"];
    }
    
    if (data.contains("health")) {
        m_health = data["health"];
    }
    
    if (data.contains("maxHealth")) {
        m_maxHealth = data["maxHealth"];
    }
    
    if (data.contains("radius")) {
        m_radius = data["radius"];
    }
    
    if (data.contains("color")) {
        m_color = data["color"];
    }
    
    if (data.contains("orbitingCircles")) {
        m_orbitingCircles.clear();
        for (const auto& circleData : data["orbitingCircles"]) {
            OrbitingCircle circle(
                circleData["angle"],
                circleData["radius"],
                circleData["orbitRadius"],
                circleData["color"]
            );
            m_orbitingCircles.push_back(circle);
        }
    }
}

void Player::updateMovement(float deltaTime, const Vector2& worldBounds) {
    // Use actual canvas size sent by client
    float canvasWidth = m_canvasWidth;
    float canvasHeight = m_canvasHeight;
    
    // Mouse coordinates are relative to canvas, convert to world target
    Vector2 targetPos;
    targetPos.x = m_position.x + (m_mouseX - canvasWidth / 2.0f);
    targetPos.y = m_position.y + (m_mouseY - canvasHeight / 2.0f);
    
    // Calculate direction and distance to target
    Vector2 direction;
    direction.x = targetPos.x - m_position.x;
    direction.y = targetPos.y - m_position.y;
    
    float distance = sqrt(direction.x * direction.x + direction.y * direction.y);
    
    // Only move if we're not too close to the target
    if (distance > 5.0f) {
        // Normalize direction
        direction.x /= distance;
        direction.y /= distance;
        
        // Apply movement speed
        const float speed = 200.0f; // pixels per second
        Vector2 newPosition;
        newPosition.x = m_position.x + direction.x * speed * deltaTime;
        newPosition.y = m_position.y + direction.y * speed * deltaTime;
        
        // Keep player within world bounds
        newPosition.x = std::max(m_radius, std::min(worldBounds.x - m_radius, newPosition.x));
        newPosition.y = std::max(m_radius, std::min(worldBounds.y - m_radius, newPosition.y));
        
        m_position = newPosition;
    }
} 