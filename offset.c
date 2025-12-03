#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/mman.h>

int main(int argc, char **argv) {
  printf(
    "{\"statOffset\": %zu, \"statSize\": %lu, \"O_RDONLY\": %d, \"O_WRONLY\": %d, \"O_RDWR\": %d, \"PROT_READ\": %d, \"PROT_WRITE\": %d, \"MADV_NORMAL\": %d, \"MADV_RANDOM\": %d, \"MADV_SEQUENTIAL\": %d, \"MADV_WILLNEED\": %d, \"MADV_DONTNEED\": %d, \"MAP_FAILED\": %lld, \"MAP_SHARED\": %d}\n",
    offsetof(struct stat, st_size),
    sizeof(struct stat),
    O_RDONLY,
    O_WRONLY,
    O_RDWR,
    PROT_READ,
    PROT_WRITE,
    MADV_NORMAL,
    MADV_RANDOM,
    MADV_SEQUENTIAL,
    MADV_WILLNEED,
    MADV_DONTNEED,
    (long long) MAP_FAILED,
    MAP_SHARED
  );
}
