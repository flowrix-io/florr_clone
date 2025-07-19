#include "PetalManager.h"
#include <iostream>
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;

PetalManager::PetalManager() {}

bool PetalManager::loadPetals(const std::string& directory) {
    for (const auto& entry : fs::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".json") {
            std::ifstream file(entry.path());
            if (file.is_open()) {
                json data;
                file >> data;
                
                try {
                    Petal petal = Petal::fromJson(data);
                    m_petalBlueprints[petal.id] = petal;
                    std::cout << "Loaded petal: " << petal.name << std::endl;
                } catch (const json::exception& e) {
                    std::cerr << "Failed to parse petal from " << entry.path() << ": " << e.what() << std::endl;
                }
            }
        }
    }
    return true;
}

const Petal* PetalManager::getPetal(const std::string& id) const {
    auto it = m_petalBlueprints.find(id);
    if (it != m_petalBlueprints.end()) {
        return &it->second;
    }
    return nullptr;
} 