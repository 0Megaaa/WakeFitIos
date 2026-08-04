if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "C:/Users/LENOVO/.gradle/caches/9.3.1/transforms/c05eee7b3fbef58e0a01bfdea96c05d2/workspace/transformed/hermes-android-250829098.0.14-debug/prefab/modules/hermesvm/libs/android.arm64-v8a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/LENOVO/.gradle/caches/9.3.1/transforms/c05eee7b3fbef58e0a01bfdea96c05d2/workspace/transformed/hermes-android-250829098.0.14-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

