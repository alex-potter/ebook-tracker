#include <jni.h>
#include <string>
#include "llama.h"

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_chaptercompanion_app_LlamaBridge_nativeVersion(JNIEnv *env, jobject /* this */) {
    return env->NewStringUTF("llama.cpp linked OK");
}

} // extern "C"
