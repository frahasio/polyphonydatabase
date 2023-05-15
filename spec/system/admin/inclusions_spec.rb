require "rails_helper"

RSpec.describe "Inclusions (admin)", type: :system do
  let!(:source) { create(:source) }

  include AdminTestHelpers
  before { log_in_admin }

  it "allows choosing a composition type" do
    create(:composition_type, name: "Mass")
    create(:composition_type, name: "Psalm/Canticle")

    click_on source.code

    fill_in "source_inclusions_attributes_0_composition_attributes_title_attributes_text", with: "Some title"
    select "Mass", from: "source_inclusions_attributes_0_composition_attributes_composition_type_id"
    click_on "Save", match: :first

    visit root_path
    expect(page).to have_text("Some title")
    expect(page).to have_text("(Mass)")
  end

  it "allows choosing a composition tone" do
    click_on source.code

    fill_in "source_inclusions_attributes_0_composition_attributes_title_attributes_text", with: "Some title"
    select "3", from: "source_inclusions_attributes_0_composition_attributes_tone"
    click_on "Save", match: :first

    visit root_path
    expect(page).to have_text("Some title")
    expect(page).to have_text("tertii toni")
  end
end
