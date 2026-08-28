package com.solvit.smssender.ui.theme;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.POST;
import retrofit2.http.GET;
import retrofit2.http.Path;

public interface SolvitApiService {
    @POST("api/log-agent")
    Call<AgentRegistrationResponse> logAgent(@Body AgentRequest request);

    @POST("api/log-event")
    Call<Void> logEvent(@Body EventRequest request);

    @GET("api/app-config/{id}")
    Call<AppConfigResponse> getAppConfig(@Path("id") long agentId);
}
