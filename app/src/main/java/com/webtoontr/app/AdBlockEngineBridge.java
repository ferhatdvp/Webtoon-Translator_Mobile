package com.webtoontr.app;

import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;
import org.mlm.adblock.AdblockEngine;
import org.mlm.adblock.BlockDecision;
import org.mlm.adblock.CosmeticResources;
import org.mlm.adblock.RequestTypeMapper;

import java.io.File;

/** Keeps the Kotlin app sources independent of the ad engine's Kotlin metadata version. */
final class AdBlockEngineBridge implements AutoCloseable {
    private final AdblockEngine engine;

    AdBlockEngineBridge() {
        engine = AdblockEngine.Companion.create();
    }

    boolean loadFilterList(String rules) {
        return engine.loadFilterList(rules);
    }

    boolean loadResources(String json) {
        return engine.loadResources(json);
    }

    boolean deserializeFrom(File file) {
        return engine.deserializeFrom(file);
    }

    boolean serializeTo(File file) {
        return engine.serializeTo(file);
    }

    boolean shouldBlock(String url, String sourceUrl, String acceptHeader) {
        String requestType = RequestTypeMapper.INSTANCE.from(Uri.parse(url), acceptHeader);
        BlockDecision decision = engine.checkNetworkRequest(url, sourceUrl, requestType);
        return decision.getMatched();
    }

    String cosmetics(String pageUrl) {
        CosmeticResources resources = engine.cosmeticResources(pageUrl);
        if (resources == null) return null;
        String css = resources.css();
        String js = resources.getJs();
        if ((css == null || css.isEmpty()) && (js == null || js.isEmpty())) return null;
        try {
            return new JSONObject()
                    .put("css", css == null ? "" : css)
                    .put("js", js == null ? "" : js)
                    .toString();
        } catch (JSONException ignored) {
            return null;
        }
    }

    @Override
    public void close() {
        engine.close();
    }
}
