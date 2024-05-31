console.log("Loading admin JS")

import "@hotwired/turbo-rails"
Turbo.session.drive = false

import "controllers"

import addTitleSelect from "admin/add_title_select"
import addComposersSelect from "admin/add_composers_select"
import addCompositionSelect from "admin/add_composition_select"

const addSelects = () => {
  addTitleSelect()
  addComposersSelect()
  addCompositionSelect()
}

addSelects()
document.addEventListener("turbo:frame-load", addSelects)
