# Deletes everything in the staged content directory that this build does not
# put there.
#
# The web link embeds the WHOLE directory (`--embed-file <dir>@data`), so the
# shipped wasm carries whatever is lying in it -- including files an earlier
# configuration staged and the current one no longer names. Nothing else
# removes those: the staging command copies the files it knows about and never
# looks at the rest, so a map dropped from maps/maps.json, or art a tileset
# stopped naming, keeps shipping for as long as the build directory lives.
# That is not visible in the artifact's behaviour, only in its size, which is
# why it went unnoticed until a committed dist/ turned out to be carrying half
# a megabyte of a world map the game had already replaced.
#
# Run as a script (cmake -P) from the staging command, with:
#   FLIX_DATA_DIR       the directory to prune
#   FLIX_DATA_MANIFEST  a file of the bare names the directory may contain
# Script mode starts with every policy at its OLD setting, and IN_LIST is not
# an `if` operator under CMP0057 OLD.
cmake_minimum_required(VERSION 3.16)

file(STRINGS "${FLIX_DATA_MANIFEST}" keep)
file(GLOB staged "${FLIX_DATA_DIR}/*")
foreach(path IN LISTS staged)
  get_filename_component(name "${path}" NAME)
  if(NOT name IN_LIST keep)
    message(STATUS "pruning stale staged content: ${name}")
    file(REMOVE_RECURSE "${path}")
  endif()
endforeach()
