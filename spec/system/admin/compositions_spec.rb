require "rails_helper"

RSpec.describe "Compositions (admin)", type: :system do
  include AdminTestHelpers
  before { log_in_admin }

  before do
    visit new_admin_composition_path
  end

  describe "assigning a title" do
    context "when the title already exists" do
      let!(:title) { create(:title, text: "Some title") }

      it "allows choosing a title" do
        click_on source.code

        select "Some title", from: "source_inclusions_attributes_0_composition_attributes_title_id"
        click_on "Save", match: :first

        visit root_path
        expect(page).to have_text("Some title")
      end
    end

    context "when the title does not exist" do
      it "requires you to add the title separately" do
        click_on source.code

        expect(page).not_to have_text("Some title")

        visit admin_titles_path
        fill_in "New title", with: "Some title"
        click_on "Create"

        visit edit_admin_source_path(source)

        select "Some title", from: "source_inclusions_attributes_0_composition_attributes_title_id"
        click_on "Save", match: :first

        visit root_path
        expect(page).to have_text("Some title")
      end
    end
  end
end
