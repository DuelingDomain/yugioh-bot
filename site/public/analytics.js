(function () {
  var key = (document.currentScript && document.currentScript.dataset.key || "").trim();
  if (!key || (location.pathname !== "/" && location.pathname !== "/index.html")) return;

  // Standard PostHog bootstrap; the SDK is fetched through the same-origin proxy.
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setGroupProperties reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureException captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init(key, {
    api_host: "/ingest",
    cookieless_mode: "always",
    capture_pageview: "history_change",
    autocapture: false,
    disable_session_recording: true,
    capture_pageleave: false,
    person_profiles: "never",
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    save_referrer: false,
    save_campaign_params: false,
    before_send: function (event) {
      if (event.event !== "$pageview" || (location.pathname !== "/" && location.pathname !== "/index.html")) return null;
      return {
        event: event.event,
        uuid: event.uuid,
        timestamp: event.timestamp,
        properties: {
          token: event.properties.token,
          distinct_id: event.properties.distinct_id,
          $cookieless_mode: event.properties.$cookieless_mode,
          $raw_user_agent: event.properties.$raw_user_agent,
          $lib: event.properties.$lib,
          $lib_version: event.properties.$lib_version,
          $process_person_profile: false,
          $current_url: location.origin + "/",
          $host: location.host,
          $pathname: "/"
        }
      };
    }
  });
})();
