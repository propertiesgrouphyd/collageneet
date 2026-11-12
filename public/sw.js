"use strict";

/*
 * ============================================================
 * VIDHWAAN NEET — SERVICE WORKER
 * ============================================================
 *
 * PWA CACHE POLICY
 * ------------------------------------------------------------
 *
 * ONLY IMAGES ARE CACHED.
 *
 * NOT CACHED:
 *
 *   - index.html
 *   - app.js
 *   - main.css
 *   - manifest.json
 *   - app-config.json
 *   - syllabus.json
 *   - day-*.dat
 *   - day-*.json
 *   - API responses
 *   - fonts
 *   - any other application/resource files
 *
 * This ensures the installed PWA always obtains the latest
 * application files from the network.
 *
 * Images are cached only for faster loading.
 *
 * ============================================================
 */

const SW_VERSION =
    "vidhwaan-neet-images-v16";


/*
 * ============================================================
 * IMAGE CACHE
 * ============================================================
 */

const IMAGE_CACHE =
    SW_VERSION;


/*
 * ============================================================
 * IMAGE DETECTION
 * ============================================================
 *
 * Only image file extensions are eligible for service-worker
 * caching.
 */

function isImageRequest(request) {

    if (
        request.method !== "GET"
    ) {
        return false;
    }


    const url =
        new URL(
            request.url
        );


    if (
        url.origin !==
        self.location.origin
    ) {
        return false;
    }


    return /\.(png|jpe?g|webp|gif|svg|ico|avif)$/i.test(
        url.pathname
    );
}


/*
 * ============================================================
 * INSTALL
 * ============================================================
 *
 * Do not pre-cache the application shell.
 *
 * Activate the new service worker immediately.
 */

self.addEventListener(
    "install",
    event => {

        event.waitUntil(
            self.skipWaiting()
        );
    }
);


/*
 * ============================================================
 * ACTIVATE
 * ============================================================
 *
 * Delete ALL previous service-worker caches.
 *
 * This removes caches created by older NEET versions,
 * including any previously cached application files.
 */

self.addEventListener(
    "activate",
    event => {

        event.waitUntil(

            caches.keys()
                .then(
                    keys =>
                        Promise.all(
                            keys.map(
                                key =>
                                    caches.delete(
                                        key
                                    )
                            )
                        )
                )
                .then(
                    () =>
                        self.clients.claim()
                )
        );
    }
);


/*
 * ============================================================
 * FETCH
 * ============================================================
 *
 * IMAGE:
 *   Cache first.
 *
 * EVERYTHING ELSE:
 *   Network only.
 *
 * No application/resource file is stored by this
 * service worker except images.
 */

self.addEventListener(
    "fetch",
    event => {

        const request =
            event.request;


        /*
         * Ignore non-GET requests.
         */

        if (
            request.method !== "GET"
        ) {
            return;
        }


        /*
         * Ignore cross-origin requests.
         */

        const url =
            new URL(
                request.url
            );


        if (
            url.origin !==
            self.location.origin
        ) {
            return;
        }


        /*
         * ========================================================
         * IMAGES — CACHE FIRST
         * ========================================================
         */

        if (
            isImageRequest(
                request
            )
        ) {

            event.respondWith(

                caches.match(
                    request
                )
                .then(
                    cachedResponse => {

                        if (
                            cachedResponse
                        ) {
                            return cachedResponse;
                        }


                        return fetch(
                            request,
                            {
                                cache:
                                    "no-store"
                            }
                        )
                        .then(
                            response => {

                                /*
                                 * Only cache successful
                                 * normal responses.
                                 */

                                if (
                                    !response ||
                                    response.status !==
                                        200 ||
                                    response.type ===
                                        "opaque"
                                ) {
                                    return response;
                                }


                                const responseToCache =
                                    response.clone();


                                caches.open(
                                    IMAGE_CACHE
                                )
                                .then(
                                    cache =>
                                        cache.put(
                                            request,
                                            responseToCache
                                        )
                                )
                                .catch(
                                    () => {
                                        /*
                                         * Image caching failure
                                         * must never prevent the
                                         * image from being displayed.
                                         */
                                    }
                                );


                                return response;
                            }
                        );
                    }
                )
            );


            return;
        }


        /*
         * ========================================================
         * EVERYTHING ELSE — NETWORK ONLY
         * ========================================================
         *
         * IMPORTANT:
         *
         * There is deliberately NO caches.match()
         * and NO cache.put() here.
         *
         * This includes:
         *
         *   index.html
         *   app.js
         *   main.css
         *   manifest.json
         *   app-config.json
         *   syllabus.json
         *   day-001.dat
         *   day-002.dat
         *   ...
         *   day-365.dat
         */

        event.respondWith(

            fetch(
                request,
                {
                    cache:
                        "no-store"
                }
            )
        );
    }
);
