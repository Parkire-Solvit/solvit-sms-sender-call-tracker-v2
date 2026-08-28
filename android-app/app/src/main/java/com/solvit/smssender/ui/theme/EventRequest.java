package com.solvit.smssender.ui.theme;

public class EventRequest {
    public String agent_name;
    public Long agent_id;
    public String type;
    public String target_phone;
    public String status;
    public String reg_no;

    public EventRequest(Long agent_id, String agent_name, String type, String target_phone, String status, String reg_no) {
        this.agent_id = agent_id;
        this.agent_name = agent_name;
        this.type = type;
        this.target_phone = target_phone;
        this.status = status;
        this.reg_no = reg_no;
    }
}
