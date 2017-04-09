require "rails_helper"

RSpec.describe Inclusion do
  let!(:piece) { FactoryGirl.create(:piece) }
  let!(:source) { FactoryGirl.create(:source) }
  let!(:inclusion) {
    FactoryGirl.create(:inclusion,
      piece: piece,
      source: source,
    )
  }

  let!(:forced_composer) { FactoryGirl.create(:composer, name: "forced") }
  let!(:cited_composer) { FactoryGirl.create(:composer, name: "cited") }
  let!(:inferred_composer) { FactoryGirl.create(:composer, name: "inferred") }

  let!(:cited_attribution) { FactoryGirl.create(:attribution) }
  let!(:inferred_attribution) { FactoryGirl.create(:attribution) }

  let!(:cited_alias) {
    FactoryGirl.create(:alias,
      composer: cited_composer,
      attribution: cited_attribution,
    )
  }

  let!(:inferred_alias) {
    FactoryGirl.create(:alias,
      composer: inferred_composer,
      attribution: inferred_attribution,
    )
  }

  let!(:citation) {
    FactoryGirl.create(:citation,
      inclusion: inclusion,
      alias: cited_alias,
    )
  }

  it "joins together forced, cited, and inferred composers" do
    inclusion.forced_composers << forced_composer
    inclusion.citations << citation
    inclusion.attributions << inferred_attribution

    inclusion.reload

    expect(inclusion.composers.map(&:name)).to match_array([
      "forced",
      "cited",
      "inferred",
    ])
  end
end
