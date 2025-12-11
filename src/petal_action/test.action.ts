/**
 * Comprehensive test petal action to test all control flow features
 * 
 * Tests included:
 * 1. Basic if/else/endif with player stats
 * 2. Loops with counters
 * 3. Nested if statements
 * 4. Goto and label
 * 5. Loadout status checks
 * 6. Global petal count checks
 * 7. Memory operations
 * 8. Player stat modifications
 * 9. Petal stat modifications
 * 10. Comparison operations
 */
export const test_petal_action = `
set_memory test_phase 1;
if memory:player:health < 50;
heal 20;
set_memory low_health 1;
else;
set_memory low_health 0;
endif;
set_memory counter 0;
loop 5;
add_memory counter 1;
if memory:counter == 3;
lightning 1000;
endif;
delay 500;
endloop;
if memory:player:extended == 1;
if memory:player:damage > 100;
damage_boost 2.0 5;
else;
speed_boost 1.5 5;
endif;
endif;
label start_sequence;
set_memory phase 1;
if memory:phase < 3;
explode 50;
add_memory phase 1;
goto start_sequence;
endif;
label end_sequence;
if memory:loadout:0:exists == 1;
if memory:loadout:0:health < 5;
set_petal_health 10;
endif;
if memory:loadout:0:onCooldown == 1;
delay 1000;
endif;
endif;
if memory:petal:count:basic > 5;
shield 100 10;
endif;
set_memory test_value 10;
multiply_memory test_value 2;
if memory:test_value > 15;
add_player_damage 5;
endif;
label loop_start;
set_memory iterations 0;
loop 10;
add_memory iterations 1;
if memory:iterations >= 10;
goto loop_end;
endif;
delay 200;
endloop;
label loop_end;
if memory:player:maxHealth < 200;
add_player_max_health 50;
endif;
if memory:player:speed < 2.0;
add_player_speed 0.5;
endif;
set_petal_damage 25;
add_petal_size 0.5;
if memory:loadout:0:health < 10;
add_petal_health 5;
endif;
set_memory restart_count 0;
add_memory restart_count 1;
if memory:restart_count < 3;
delay 2000;
restart;
endif;
compare_gt memory:player:health 50 compare_result;
if memory:compare_result == 1;
heal 10;
endif;
`;
