import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  saveInProgress = false;
  submitRequested = false;

  markSaveInProgress() {
    this.saveInProgress = true;
  }

  saveComplete() {
    this.saveInProgress = false;

    if (this.submitRequested) {
      this.submitRequested = false;
      this.element.requestSubmit();
    }
  }

  submit(event) {
    if (!this.saveInProgress) {
      return true;
    }

    event.preventDefault();

    this.submitRequested = true;

    // Fallback timeout to ensure that the form is submitted
    setTimeout(() => this.saveComplete(), 1000);
  }
}
