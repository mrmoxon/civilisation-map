// Web Worker: fetch + JSON.parse off the main thread
self.onmessage = async function(e) {
    const { url } = e.data;
    try {
        const response = await fetch(url);
        const data = await response.json();
        self.postMessage({ url, data });
    } catch (err) {
        self.postMessage({ url, error: err.message });
    }
};
