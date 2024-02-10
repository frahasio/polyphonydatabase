require "rails_helper"

RSpec.describe "Inclusions (admin)", type: :system do
  let!(:source) { create(:source) }

  include AdminTestHelpers
  before { log_in_admin }

  describe "attributing a composer" do
    context "when the composer already exists" do
      let!(:composer) { create(:composer, name: "Jeremy Makemusic") }

      it "allows choosing a composer" do
        click_on source.code

        fill_in "source_inclusions_attributes_0_composition_attributes_title_attributes_text", with: "Some title"
        fill_in "source_inclusions_attributes_0_attributions_attributes_0_text", with: "Jimmy Musics"
        select "Jeremy Makemusic", from: "source_inclusions_attributes_0_attributions_attributes_0_refers_to_id"
        click_on "Save", match: :first

        visit root_path
        expect(page).to have_text("Jimmy Musics")
        expect(page).to have_text("Jeremy Makemusic")
      end
    end

    context "when the composer does not exist" do
      it "requires you to add the composer separately" do
        click_on source.code

        expect(page).not_to have_text("Jeremy Makemusic")

        visit new_admin_composer_path
        fill_in "Name", with: "Jeremy Makemusic"
        click_on "Create"

        visit edit_admin_source_path(source)

        fill_in "source_inclusions_attributes_0_composition_attributes_title_attributes_text", with: "Some title"
        fill_in "source_inclusions_attributes_0_attributions_attributes_0_text", with: "Jimmy Musics"
        select "Jeremy Makemusic", from: "source_inclusions_attributes_0_attributions_attributes_0_refers_to_id"
        click_on "Save", match: :first

        visit root_path
        expect(page).to have_text("Jimmy Musics")
        expect(page).to have_text("Jeremy Makemusic")
      end
    end
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
