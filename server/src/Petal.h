#pragma once

#include <string>
#include <vector>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

struct Petal {
    std::string id;
    std::string name;
    std::string asset;
    int damage;
    float radius;
    float orbitRadius;
    float rotationSpeed;
    
    // For orbiting
    float angle = 0.0f;

    static Petal fromJson(const json& j);
};

void to_json(json& j, const Petal& p); 