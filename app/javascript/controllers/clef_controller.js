import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["delete"]

  change(e) {
    e.preventDefault()

    this.deleteTarget.value = (e.target.value === "")
  }
}
