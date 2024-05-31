import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "languageSelect",
    "titleSelect"
  ]

  changeLanguage() {
    this.titleSelectTarget.value = ""
    this.titleSelectTarget.dataset.language = this.languageSelectTarget.value
    this.titleSelectTarget.dispatchEvent(new Event("change"))
  }
}
