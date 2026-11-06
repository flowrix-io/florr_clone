#pragma once
// Shared, explicit casino economics. Payouts include the returned stake.
#include <array>
#include <cmath>
#include <string>
namespace flix {
inline constexpr int kCasinoChipsPerStar = 1;
inline constexpr int kCasinoMaxBet = 19000;
inline constexpr double kCasinoMaxBalance = 1000000000.0;
inline bool casinoBalanceValid(double value) {
    return std::isfinite(value) && value >= 0 && value <= kCasinoMaxBalance &&
           std::floor(value) == value;
}
// Sixteen fair left/right decisions, with florr's seventeen-bucket layout.
inline constexpr int kPlinkoRows = 16;
inline constexpr std::array<int, 17> kPlinkoPayouts{{500,20,5,3,2,0,1,1,1,1,1,0,2,3,5,20,500}};
inline int plinkoSlot(int path) {
    if(path < 0 || path >= 65536) return -1;
    int rights=0;
    for(int row=0;row<kPlinkoRows;++row) rights+=(path>>row)&1;
    return rights;
}
// Strict decimal input with optional k/K. Never accepts signs, exponents,
// trailing garbage, sub-chip fractions, or values beyond the action limit.
inline bool parseCasinoAmount(const std::string& input,int& amount) {
    if(input.empty() || input.size()>16) return false;
    const bool kilo=input.back()=='k' || input.back()=='K';
    const std::size_t end=input.size()-(kilo?1:0);
    if(!end)return false;
    long long digits=0,scale=1;bool dot=false,any=false,after=false;
    for(std::size_t i=0;i<end;++i) {
        const char c=input[i];
        if(c=='.' && !dot && kilo && any){dot=true;continue;}
        if(c<'0'||c>'9')return false;
        any=true;digits=digits*10+(c-'0');
        if(digits>19000000)return false;
        if(dot){after=true;scale*=10;if(scale>1000)return false;}
    }
    if(!any || (dot&&!after))return false;
    const long long numerator=digits*(kilo?1000:1);
    if(numerator%scale)return false;
    const long long value=numerator/scale;
    if(value<1 || value>kCasinoMaxBet)return false;
    amount=static_cast<int>(value);return true;
}
} // namespace flix
