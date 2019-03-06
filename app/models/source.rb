class Source < ActiveRecord::Base
  self.inheritance_column = :_type_disabled

  validates :code, presence: true, uniqueness: true

  has_many :inclusions, inverse_of: :source
  accepts_nested_attributes_for :inclusions, reject_if: :unfilled?

  has_and_belongs_to_many :publishers, inverse_of: :sources
  has_and_belongs_to_many :scribes, inverse_of: :sources

  scope :uncatalogued, -> { where(catalogued: false) }
  scope :catalogued, -> { where(catalogued: true) }

  before_validation :update_dates_string, :update_location_and_pubscribe

  TYPES = %w[
    MS
    Print
    Print/MS
  ].freeze

  FORMATS = %w[
    Choirbook
    Partbook
    Score
    Tablature
    Tablebook
    Choirbook/score
    Unidentifiable/fragment
  ].freeze

  def from_year=(_)
    super
    update_dates_string
  end

  def from_year_annotation=(_)
    super
    update_dates_string
  end

  def to_year=(_)
    super
    update_dates_string
  end

  def to_year_annotation=(_)
    super
    update_dates_string
  end

  def town=(_)
    super
    update_location_and_pubscribe
  end

  def publisher_or_scribe=(_)
    super
    update_location_and_pubscribe
  end

private

  def update_dates_string
    self.dates = [
      "#{from_year_annotation}#{from_year}",
      "#{to_year_annotation}#{to_year}",
    ].reject(&:blank?).join("-")
  end

  def update_location_and_pubscribe
    self.location_and_pubscribe = [
      town,
      (publishers + scribes).map(&:name).to_sentence,
    ].reject(&:blank?).join(": ")
  end

  def unfilled?(attrs)
    attrs.dig(:composition_attributes, :title_attributes, :text).blank?
  end
end
