console.log("Loading admin JS")

import "@hotwired/turbo-rails"
Turbo.session.drive = false

import "controllers"

import addTitleSelect from "./admin/add_title_select"
addTitleSelect()

import addComposersSelect from "./admin/add_composers_select"
addComposersSelect()

import addCompositionSelect from "./admin/add_composition_select"
addCompositionSelect()
