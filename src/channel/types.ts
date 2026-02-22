export interface FeishuEvent {
  header: {
    event_id: string
    timestamp: string
    event_type: string
    tenant_key: string
    app_id: string
  }
  event: {
    sender: {
      sender_id: { open_id: string }
      sender_type: string
    }
    message: {
      message_id: string
      chat_type: string
      chat_id: string
      message_type: string
      content: string
      mention?: any
    }
  }
}
