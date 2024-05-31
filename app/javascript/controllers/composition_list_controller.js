import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  select(e) {
    window.location.href = "/admin/compositions?title_id=" + e.params.data.id;
  }
}
