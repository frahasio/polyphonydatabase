require "rails_helper"

RSpec.describe "Pagination", type: :system do
  let!(:groups) { create_list(:group, 30, :with_composition) }

  it "paginates groups on the homepage" do
    visit groups_path

    expect(page).to have_css(".group", count: 25)

    expect(page).to have_link("2", href: groups_path(page: 2))
    expect(page).to have_link("Next", href: groups_path(page: 2))

    click_on "Next"

    expect(page).to have_css(".group", count: 5)
  end
end
