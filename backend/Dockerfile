# syntax=docker/dockerfile:1
FROM debian:trixie AS builder
RUN apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
      build-essential ca-certificates cmake ninja-build git curl zip unzip tar pkg-config \
      autoconf autoconf-archive automake libtool bison flex perl python3 linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/microsoft/vcpkg /opt/vcpkg \
    && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics
ENV VCPKG_ROOT=/opt/vcpkg
# Needed on arm64 Linux hosts; harmless on x86_64.
ENV VCPKG_FORCE_SYSTEM_BINARIES=1

WORKDIR /src
# Dependencies first so they stay cached across source-only changes.
COPY vcpkg.json ./
RUN /opt/vcpkg/vcpkg install --x-install-root=/src/vcpkg_installed
COPY . .
RUN cmake --preset release -DVCPKG_INSTALLED_DIR=/src/vcpkg_installed -DTRADEAI_BUILD_TESTS=OFF \
    && cmake --build --preset release

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home app
COPY --from=builder /src/build/release/tradeai_api /usr/local/bin/tradeai_api
USER app
EXPOSE 8080
CMD ["/usr/local/bin/tradeai_api"]
