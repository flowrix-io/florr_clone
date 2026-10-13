#include "shared/core/world.h"
#include "shared/game/components.h"
#include <chrono>
#include <cstdio>
using namespace flix;
int main() {
 World w;
 for(int i=0;i<64;i++) { auto e=w.create();w.add<NetId>(e);w.add<Replicated>(e);w.add<Transform>(e);
 if(i&1)w.add<Body>(e);if(i&2)w.add<Motion>(e);if(i&4)w.add<Health>(e);
 if(i&8)w.add<Faction>(e);if(i&16)w.add<PlayerTag>(e);if(i&32)w.add<MobTag>(e); }
 volatile unsigned long long count=0;Query<NetId,Replicated,Transform> cached(w);
 auto run=[&](bool reuse){auto start=std::chrono::steady_clock::now();
 for(int i=0;i<20000;i++) { if(reuse)cached.each([&](Entity,NetId&,Replicated&,Transform&){++count;});
 else {Query<NetId,Replicated,Transform> q(w);q.each([&](Entity,NetId&,Replicated&,Transform&){++count;});}}
 return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();};
 double fresh=run(false),reuse=run(true);std::printf("20k queries / 64 archetypes: fresh %.3f ms cached %.3f ms visits %llu\n",fresh,reuse,count);
 return count==2560000?0:1;
}