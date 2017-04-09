class Source < ActiveRecord::Base
  self.inheritance_column = :_type_disabled

  validates :code, presence: true, uniqueness: true

  has_many :inclusions, inverse_of: :source
  # has_many :pieces, through: :inclusions
  accepts_nested_attributes_for :inclusions, reject_if: :unfilled?

  scope :uncatalogued, -> { where(catalogued: false) }
  scope :catalogued, -> { where(catalogued: true) }

  TYPES = %w[
    MS
    Print
  ].freeze

  FORMATS = %w[
    Choirbook
    Partbook
    Score
  ].freeze

  PUBLISHERS = [
    "Attaigngnant",
    "Gardano, Angelo",
  ].freeze

private

  def unfilled?(attrs)
    unfilled_attributions?(attrs) && unfilled_piece?(attrs)
  end

  def unfilled_attributions?(attrs)
    return true unless attrs.has_key?(:attributions_attributes)

    attrs[:attributions_attributes].values.all? do |attribution|
      attribution[:anonym_attributes] && attribution[:anonym_attributes].values.all?(&:blank?)
    end
  end

  def unfilled_piece?(attrs)
    return true unless attrs.has_key?(:piece_attributes)

    attrs[:piece_attributes].values.all?(&:blank?)
  end
end
