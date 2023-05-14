class Group < ApplicationRecord
  has_many :compositions, inverse_of: :group
  has_many :composition_types, through: :compositions

  has_many :composers, through: :compositions
  has_many :inclusions, through: :compositions
  has_many :attributions, through: :inclusions
  has_many :sources, through: :inclusions
  has_many :clef_combinations, through: :inclusions
  has_many :voicings, through: :clef_combinations

  has_many :editions, inverse_of: :group
  has_many :editors, through: :editions
  has_many :recordings, inverse_of: :group
  has_many :performers, through: :recordings

  has_many :titles, through: :compositions
  has_many :functions, through: :titles

  validate :matching_voices

  accepts_nested_attributes_for :editions, reject_if: :all_blank
  before_validation :delete_blank_editions

  accepts_nested_attributes_for :recordings, reject_if: :all_blank
  before_validation :delete_blank_recordings

  def multiple?
    @multiple = (compositions.size > 1) if @multiple.nil?
    @multiple
  end

  def conflicting_attributions?
    return false unless multiple?

    compositions.map {|c| c.composers.order(:id).to_a }.uniq.size > 1
  end

  def delete_if_empty(composition_to_ignore = nil)
    if compositions.empty? || compositions == [composition_to_ignore]
      self.destroy
    end
  end

private

  def delete_blank_editions
    editions.each do |edition|
      edition.mark_for_destruction if edition.voicing.blank? && edition.file_url.blank?
    end
  end

  def delete_blank_recordings
    recordings.each do |recording|
      recording.mark_for_destruction if recording.file_url.blank?
    end
  end

  def matching_voices
    if compositions.pluck(:number_of_voices).uniq.count > 1
      errors.add(:base, "All compositions in the group must have the same number of voices")
    end
  end
end
