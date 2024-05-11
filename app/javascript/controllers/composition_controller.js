import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "composerIds",
    "compositionId",
    "evenOdd",
    "numberOfVoices",
    "titleId",
    "tone",
    "typeId"
  ]

  numberOfVoicesTargetConnected(element) {
    element.onkeydown = this.keydown.bind(this);
  }

  focusout() {
    this.timeout = setTimeout(this.submit.bind(this), 100)
  }

  focusin() {
    clearTimeout(this.timeout)
  }

  keydown(event) {
    return event.keyCode != 13;
  }

  submit() {
    const selectedComposerIds = Array.from(this.composerIdsTarget.selectedOptions)
      .map(({ value }) => value);

    const compositionData = {
      title_id: this.titleIdTarget.value,
      composer_ids: selectedComposerIds,
      composition_type_id: this.typeIdTarget.value,
      tone: this.toneTarget.value,
      number_of_voices: this.numberOfVoicesTarget.value,
      even_odd: this.evenOddTarget.value,
    }

    fetch("/admin/compositions/find-or-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content,
        accept: "application/json",
      },
      body: JSON.stringify({ composition: compositionData })
    })
    .then(response => {
      if (response.ok) {
        response.json().then(data => {
          if (data.id) {
            this.compositionIdTarget.value = data.id
            this.showSuccess.bind(this)()
          }
        })
      } else {
        this.showError.bind(this)()
      }
    })
    .catch(() => {
      this.showError.bind(this)()
    })
  }

  showSuccess() {
    this.flashBorder(this.element, "green")
  }

  showError() {
    this.flashBorder(this.element, "red")
  }

  flashBorder(element, color) {
    element.style.boxShadow = `inset 0 0 0 2px ${color}`;
    element.style.transition = "box-shadow 1000ms";
    setTimeout(() => {
      element.style.boxShadow = "";
    }, 1000);
  }
}
