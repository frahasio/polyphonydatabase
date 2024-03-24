import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["delete"]

  change(e) {
    e.preventDefault()

    if (e.target.value === "") {
      this.deleteTarget.value = true
    }
  }
}
