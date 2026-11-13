class ActionController {
  configure(handlers) { this.handlers = handlers; }

  async execute(action, body = {}) {
    if (!this.handlers) throw new Error('Action controller is not configured.');
    const allowed = {
      capture: () => this.handlers.capture({ sourceId: body.sourceId }),
      selectTarget: () => this.handlers.selectTarget(body.sourceId),
      setCrop: () => this.handlers.setCrop(body.crop),
      submit: () => this.handlers.submit(body),
      clearQueue: () => this.handlers.clearQueue(),
      showAnswerPanels: () => this.handlers.showAnswerPanels(),
      toggleOverlay: () => this.handlers.toggleOverlay(),
      toggleInteraction: () => this.handlers.toggleInteraction(),
      openChat: () => this.handlers.openChat(),
      openSettings: () => this.handlers.openSettings(),
      toggleSpeech: () => this.handlers.toggleSpeech(),
      selectSkill: () => this.handlers.selectSkill(body.skill),
      movePanels: () => this.handlers.movePanels(body.direction),
      newConversation: () => this.handlers.newConversation(),
      selectConversation: () => this.handlers.selectConversation(body.conversationId),
      audioSource: () => this.handlers.audioSource(body.source),
      computerMicrophone: () => this.handlers.computerMicrophone(body.enabled),
      sendMessage: () => this.handlers.sendMessage(body),
      resendMessage: () => this.handlers.resendMessage(body)
    };
    if (!Object.prototype.hasOwnProperty.call(allowed, action)) {
      throw Object.assign(new Error('Unknown action.'), { statusCode: 404 });
    }
    return allowed[action]();
  }
}

module.exports = new ActionController();
