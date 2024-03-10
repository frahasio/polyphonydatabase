console.log("Loading admin JS")

import "@hotwired/turbo-rails"
Turbo.session.drive = false

import "controllers"

import addTitleSelect from "./admin/add_title_select"
addTitleSelect()
